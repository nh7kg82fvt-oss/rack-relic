-- CLOSED, UNINSTALLED source proposal. Uses existing heads/outbox/audit only.
-- No grants, scheduler, transport, enrollment creation, backfill or queue refresh.
-- Caller scope is host-private owner-reviewed configuration, NOT consent proof.
BEGIN;
CREATE FUNCTION rr_sandbox.enrolled_alert_matches(s jsonb,q rr_sandbox.case_alert_outbox,h rr_sandbox.case_alert_heads)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m jsonb;
BEGIN
 IF s IS NULL OR jsonb_typeof(s)<>'object' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(s) x WHERE x.value='null'::jsonb OR
   jsonb_typeof(x.value)<>CASE WHEN x.key IN ('alertId','generation','createdAfter') THEN 'number' ELSE 'string' END) OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM
  ARRAY['alertId','caseId','createdAfter','evidenceHash','generation','orderId','payloadHash','payloadJson','providerEventId','providerPayloadHash','version']::text[]
  OR s->>'version'<>'rr-case-alert-scope-v1' OR (s->>'alertId')::bigint<>q.id
  OR s->>'caseId'<>q.case_id OR s->>'orderId'<>h.order_id::text OR (s->>'generation')::bigint<>q.generation
  OR q.generation<>h.generation OR q.case_id<>h.case_id OR s->>'evidenceHash'<>h.evidence_hash
  OR s->>'providerEventId'<>h.latest_event_id OR s->>'providerPayloadHash' !~ '^[a-f0-9]{64}$'
  OR s->>'payloadHash' !~ '^[a-f0-9]{64}$' OR octet_length(s->>'payloadJson')>8192
  OR q.kind<>'case_changed' OR q.superseded_at IS NOT NULL
  OR h.case_id='issfr_RackOwnerAlertRehearsal' OR h.order_id='a11e4700-0000-4000-8000-000000000002'::uuid
  OR h.provider_status IN ('won','lost','prevented','warning_closed')
  OR q.created_at<to_timestamp((s->>'createdAfter')::bigint/1000.0)
  OR q.snapshot IS DISTINCT FROM rr_sandbox.case_alert_projection(h) THEN RETURN false; END IF;
 -- Raw signed-ingestion digest and exact current notice ancestry, not a copied
 -- boolean. Signature acceptance itself remains the unchanged receiver's job.
 IF NOT EXISTS(SELECT 1 FROM rr_sandbox.provider_risk_notices n JOIN rr_sandbox.provider_events e ON e.id=n.event_id
  WHERE n.event_id=h.latest_event_id AND n.order_id=h.order_id AND n.case_id=h.case_id AND n.kind=h.kind
   AND e.order_id=h.order_id AND e.payload_hash=s->>'providerPayloadHash') THEN RETURN false; END IF;
 m:=jsonb_build_object('version','rr-case-alert-message-v1','test',true,'caseRef',h.case_id,'orderRef',h.order_id,
  'caseKind',h.kind,'caseStatus',q.snapshot->'status','requiresResponse',h.requires_response,
  'providerDueBy',q.snapshot->'providerDueBy',
  'retainedDueBy',q.snapshot->'dueBy',
  'deadlineReviewRequired',h.due_by IS DISTINCT FROM h.provider_due_by,'evidenceConflict',h.evidence_conflict,
  'severity',q.severity,'holdRequired',true,'releaseEnabled',false);
 RETURN (s->>'payloadJson')::jsonb=m AND encode(sha256(convert_to(s->>'payloadJson','UTF8')),'hex')=s->>'payloadHash';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION rr_sandbox.enrolled_alert_window(s jsonb,w uuid,c bigint,e bigint) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(w IS NOT NULL AND w<>'00000000-0000-0000-0000-000000000000'::uuid
  AND w<>'a11e4700-0000-4000-8000-000000000001'::uuid
  AND c>0 AND e>c AND e-c<=300000 AND c<=extract(epoch FROM clock_timestamp())*1000
  AND e>extract(epoch FROM clock_timestamp())*1000
  AND (s->>'createdAfter')::bigint BETWEEN c-300000 AND c,false)
$$;

CREATE FUNCTION public.rr_test_claim_enrolled_case_alert(p_worker uuid,p_scope jsonb,p_checked_at bigint,p_expires_at bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE h rr_sandbox.case_alert_heads; q rr_sandbox.case_alert_outbox;
 empty_batch jsonb:=jsonb_build_object('test',true,'cloudReady',false,'releaseEnabled',false,'alerts','[]'::jsonb);
BEGIN
 IF rr_sandbox.enrolled_alert_window(p_scope,p_worker,p_checked_at,p_expires_at) IS NOT TRUE THEN RETURN empty_batch; END IF;
 -- Same head -> outbox lock order as signed-notice capture. Never lock/refresh
 -- a foreign row; contention fails closed for this one request.
 SELECT * INTO h FROM rr_sandbox.case_alert_heads WHERE case_id=p_scope->>'caseId' FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN empty_batch; END IF;
 SELECT * INTO q FROM rr_sandbox.case_alert_outbox WHERE id=(p_scope->>'alertId')::bigint AND case_id=h.case_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR rr_sandbox.enrolled_alert_matches(p_scope,q,h) IS NOT TRUE
  OR q.state<>'pending' OR q.attempts<>0 OR q.lease_token IS NOT NULL OR q.worker_id IS NOT NULL OR q.leased_until IS NOT NULL
  OR q.delivered_at IS NOT NULL OR q.delivery_reference IS NOT NULL OR q.last_failure IS NOT NULL
  OR q.next_attempt_at>clock_timestamp() OR EXISTS(SELECT 1 FROM rr_sandbox.case_alert_delivery_audit WHERE alert_id=q.id)
  OR rr_sandbox.enrolled_alert_window(p_scope,p_worker,p_checked_at,p_expires_at) IS NOT TRUE THEN RETURN empty_batch; END IF;
 UPDATE rr_sandbox.case_alert_outbox SET state='leased',attempts=1,worker_id=p_worker,lease_token=gen_random_uuid(),
  leased_until=clock_timestamp()+interval '90 seconds' WHERE id=q.id RETURNING * INTO q;
 RETURN jsonb_build_object('test',true,'cloudReady',false,'releaseEnabled',false,'alerts',jsonb_build_array(jsonb_build_object(
  'alertId',q.id,'deliveryKey','rr_test_case_alert_'||q.id,'leaseToken',q.lease_token,'leasedUntil',q.leased_until,
  'attempt',q.attempts,'kind',q.kind,'severity',q.severity,'case',q.snapshot||jsonb_build_object('test',true),
  'evidenceHash',h.evidence_hash,'providerEventId',h.latest_event_id,'providerPayloadHash',p_scope->>'providerPayloadHash')));
END $$;

CREATE FUNCTION public.rr_test_enrolled_case_alert_authority(p_alert bigint,p_worker uuid,p_lease uuid,p_scope jsonb,p_checked_at bigint,p_expires_at bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('test',true,'releaseEnabled',false,'allowed',coalesce(
  rr_sandbox.enrolled_alert_window(p_scope,p_worker,p_checked_at,p_expires_at) AND EXISTS(
   SELECT 1 FROM rr_sandbox.case_alert_outbox q JOIN rr_sandbox.case_alert_heads h ON h.case_id=q.case_id
   WHERE q.id=p_alert AND q.state='leased' AND q.attempts=1 AND q.worker_id=p_worker AND q.lease_token=p_lease
    AND q.leased_until>clock_timestamp() AND rr_sandbox.enrolled_alert_matches(p_scope,q,h)),false))
$$;
REVOKE ALL ON FUNCTION rr_sandbox.enrolled_alert_matches(jsonb,rr_sandbox.case_alert_outbox,rr_sandbox.case_alert_heads),
 rr_sandbox.enrolled_alert_window(jsonb,uuid,bigint,bigint),public.rr_test_claim_enrolled_case_alert(uuid,jsonb,bigint,bigint),
 public.rr_test_enrolled_case_alert_authority(bigint,uuid,uuid,jsonb,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

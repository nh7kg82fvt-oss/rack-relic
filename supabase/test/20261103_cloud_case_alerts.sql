-- Staging-only cloud monitoring foundation, after provider_risk_holds.
-- The signed receiver remains the only provider-notice ingestion path.
-- No scheduler, transport, notification, production authority or money release
-- is enabled by installing this schema. Never expose worker RPCs to a browser.
BEGIN;
CREATE TABLE rr_sandbox.case_alert_heads (
 case_id text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES rr_sandbox.orders(id),
 kind text NOT NULL CHECK(kind IN ('dispute','early_fraud_warning')),
 provider_status text NOT NULL,
 amount_cents bigint,
 due_by timestamptz,
 provider_due_by timestamptz,
 requires_response boolean NOT NULL,
 evidence_conflict boolean NOT NULL DEFAULT false,
 latest_event_created bigint NOT NULL,
 latest_event_id text NOT NULL REFERENCES rr_sandbox.provider_risk_notices(event_id),
 generation bigint NOT NULL CHECK(generation>0),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{32}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rr_sandbox.case_alert_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id text NOT NULL REFERENCES rr_sandbox.case_alert_heads(case_id),
 generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('case_changed','deadline')),
 severity integer NOT NULL CHECK(severity BETWEEN 0 AND 3),
 snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','delivered','exhausted','unknown','superseded')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token uuid,
 worker_id uuid,
 leased_until timestamptz,
 superseded_at timestamptz,
 delivered_at timestamptz,
 delivery_reference text,
 last_failure text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,generation,kind,severity)
);
CREATE TABLE rr_sandbox.case_alert_delivery_audit (
 alert_id bigint NOT NULL REFERENCES rr_sandbox.case_alert_outbox(id),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),
 outcome text NOT NULL CHECK(outcome IN ('delivered','temporary_failure','permanent_failure','outcome_unknown','lease_expired','outcome_conflict')),
 delivery_reference text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(alert_id,attempt,outcome)
);
ALTER TABLE rr_sandbox.case_alert_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.case_alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.case_alert_delivery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.case_alert_heads,rr_sandbox.case_alert_outbox,rr_sandbox.case_alert_delivery_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE rr_sandbox.case_alert_outbox_id_seq FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX case_alert_pending ON rr_sandbox.case_alert_outbox(next_attempt_at,id) WHERE state='pending';
CREATE UNIQUE INDEX case_alert_delivery_reference ON rr_sandbox.case_alert_outbox(delivery_reference) WHERE delivery_reference IS NOT NULL;

CREATE FUNCTION rr_sandbox.case_alert_severity(p_response boolean,p_due timestamptz) RETURNS integer
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_response IS NOT TRUE OR p_due IS NULL THEN 0
  WHEN p_due<=clock_timestamp() THEN 3 WHEN p_due<=clock_timestamp()+interval '4 hours' THEN 2
  WHEN p_due<=clock_timestamp()+interval '24 hours' THEN 1 ELSE 0 END
$$;
CREATE FUNCTION rr_sandbox.case_alert_projection(h rr_sandbox.case_alert_heads) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('caseId',h.case_id,'orderId',h.order_id,'kind',h.kind,
  'status',CASE WHEN h.evidence_conflict THEN 'conflicting_evidence' ELSE h.provider_status END,
  'amountCents',h.amount_cents,'currency',CASE WHEN h.amount_cents IS NULL THEN NULL ELSE 'USD' END,
  'dueBy',h.due_by,'providerDueBy',h.provider_due_by,'deadlineReviewRequired',h.due_by IS DISTINCT FROM h.provider_due_by,
  'requiresResponse',h.requires_response,'evidenceConflict',h.evidence_conflict,
  'generation',h.generation,'providerEventCreated',h.latest_event_created,'observedAt',h.observed_at,
  'holdRequired',true,'releaseEnabled',false)
$$;
CREATE FUNCTION rr_sandbox.enqueue_case_alert(h rr_sandbox.case_alert_heads,p_kind text,p_severity integer) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- Newer evidence or a stronger deadline warning makes unsent older work stale.
 UPDATE rr_sandbox.case_alert_outbox SET superseded_at=coalesce(superseded_at,clock_timestamp()),
  state=CASE WHEN state='pending' THEN 'superseded' ELSE state END
 WHERE case_id=h.case_id AND state IN ('pending','leased') AND superseded_at IS NULL
  AND (generation<>h.generation OR severity<p_severity);
 INSERT INTO rr_sandbox.case_alert_outbox(case_id,generation,kind,severity,snapshot)
 VALUES(h.case_id,h.generation,p_kind,p_severity,rr_sandbox.case_alert_projection(h)) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION rr_sandbox.capture_case_alert(n rr_sandbox.provider_risk_notices) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h rr_sandbox.case_alert_heads; normalized text; response boolean; changed boolean:=false;
BEGIN
 IF n.case_id !~ '^(du|issfr)_[A-Za-z0-9]+$' OR n.kind NOT IN ('dispute','early_fraud_warning')
  OR n.status NOT IN ('warning_received','warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','appeal_needs_response','appeal_under_review','won','lost','prevented')
  OR n.event_created<1 THEN RAISE EXCEPTION 'Verified provider case required'; END IF;
 response:=n.status IN ('warning_needs_response','needs_response','appeal_needs_response');
 normalized:=md5(jsonb_build_array(n.kind,n.status,n.amount_cents,extract(epoch FROM n.due_by))::text);
 SELECT * INTO h FROM rr_sandbox.case_alert_heads WHERE case_id=n.case_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO rr_sandbox.case_alert_heads(case_id,order_id,kind,provider_status,amount_cents,due_by,provider_due_by,requires_response,
   latest_event_created,latest_event_id,generation,evidence_hash)
  VALUES(n.case_id,n.order_id,n.kind,n.status,n.amount_cents,n.due_by,n.due_by,response,n.event_created,n.event_id,1,normalized)
  RETURNING * INTO h;changed:=true;
 ELSE
  IF h.order_id<>n.order_id OR h.kind<>n.kind THEN RAISE EXCEPTION 'Provider case identity collision'; END IF;
  IF n.event_created<h.latest_event_created THEN RETURN; END IF;
  IF n.event_created=h.latest_event_created AND normalized<>h.evidence_hash THEN
   -- A same-second conflict cannot erase an actionable status or postpone its
   -- earliest known deadline. Raw provider notices remain available privately.
   changed:=NOT h.evidence_conflict OR response AND NOT h.requires_response
    OR n.due_by IS NOT NULL AND (h.due_by IS NULL OR n.due_by<h.due_by);
   UPDATE rr_sandbox.case_alert_heads SET evidence_conflict=true,
    requires_response=requires_response OR response,
    due_by=CASE WHEN due_by IS NULL THEN n.due_by WHEN n.due_by IS NULL THEN due_by ELSE least(due_by,n.due_by) END,
    generation=generation+CASE WHEN changed THEN 1 ELSE 0 END,observed_at=clock_timestamp()
   WHERE case_id=n.case_id RETURNING * INTO h;
  ELSIF n.event_created>h.latest_event_created THEN
   changed:=normalized<>h.evidence_hash OR response<>h.requires_response;
   -- A newer reported extension/removal remains visible, but cannot silently
   -- erase the earlier deadline from the review queue. Human reconciliation of
   -- the provider's actual deadline is a separate future policy, not a hold clear.
   UPDATE rr_sandbox.case_alert_heads SET provider_status=n.status,amount_cents=n.amount_cents,provider_due_by=n.due_by,
    due_by=CASE WHEN due_by IS NULL THEN n.due_by WHEN n.due_by IS NULL THEN due_by ELSE least(due_by,n.due_by) END,
    requires_response=response,latest_event_created=n.event_created,latest_event_id=n.event_id,evidence_hash=normalized,
    generation=generation+CASE WHEN changed THEN 1 ELSE 0 END,observed_at=clock_timestamp()
   WHERE case_id=n.case_id RETURNING * INTO h;
  END IF;
 END IF;
 IF changed THEN PERFORM rr_sandbox.enqueue_case_alert(h,'case_changed',rr_sandbox.case_alert_severity(h.requires_response,h.due_by)); END IF;
END $$;
CREATE FUNCTION rr_sandbox.capture_case_alert_trigger() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN PERFORM rr_sandbox.capture_case_alert(NEW);RETURN NEW;END $$;
CREATE TRIGGER capture_cloud_case_alert AFTER INSERT ON rr_sandbox.provider_risk_notices
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.capture_case_alert_trigger();
-- Preserve existing verified history; do not reset orders or manufacture events.
DO $$ DECLARE n rr_sandbox.provider_risk_notices; BEGIN
 FOR n IN SELECT * FROM rr_sandbox.provider_risk_notices ORDER BY event_created,event_id LOOP
  PERFORM rr_sandbox.capture_case_alert(n);
 END LOOP;
END $$;

CREATE FUNCTION rr_sandbox.refresh_case_alerts() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h rr_sandbox.case_alert_heads; q rr_sandbox.case_alert_outbox; current_severity integer;
BEGIN
 FOR q IN SELECT * FROM rr_sandbox.case_alert_outbox WHERE state='leased' AND leased_until<=clock_timestamp() FOR UPDATE SKIP LOCKED LOOP
  INSERT INTO rr_sandbox.case_alert_delivery_audit(alert_id,attempt,outcome) VALUES(q.id,q.attempts,'lease_expired') ON CONFLICT DO NOTHING;
  UPDATE rr_sandbox.case_alert_outbox SET state='unknown',last_failure='lease_expired' WHERE id=q.id;
 END LOOP;
 FOR h IN SELECT c.* FROM rr_sandbox.case_alert_heads c WHERE c.requires_response AND c.due_by IS NOT NULL
  AND rr_sandbox.case_alert_severity(c.requires_response,c.due_by)>0
  AND NOT EXISTS(SELECT 1 FROM rr_sandbox.case_alert_outbox existing WHERE existing.case_id=c.case_id AND existing.generation=c.generation
   AND existing.severity>=rr_sandbox.case_alert_severity(c.requires_response,c.due_by))
  ORDER BY c.due_by,c.case_id LIMIT 100 FOR UPDATE OF c SKIP LOCKED LOOP
  current_severity:=rr_sandbox.case_alert_severity(h.requires_response,h.due_by);
  IF current_severity>0 AND NOT EXISTS(SELECT 1 FROM rr_sandbox.case_alert_outbox WHERE case_id=h.case_id AND generation=h.generation AND severity>=current_severity) THEN
   PERFORM rr_sandbox.enqueue_case_alert(h,'deadline',current_severity);
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.rr_test_case_alert_queue(p_limit integer DEFAULT 25,p_after_case text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cases jsonb; total bigint; pending bigint; unknown bigint; exhausted bigint;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_after_case IS NOT NULL AND p_after_case !~ '^(du|issfr)_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Bounded case limit and cursor required'; END IF;
 SELECT count(*) INTO total FROM rr_sandbox.case_alert_heads WHERE p_after_case IS NULL OR case_id>p_after_case;
 SELECT coalesce(jsonb_agg(rr_sandbox.case_alert_projection(h::rr_sandbox.case_alert_heads)||jsonb_build_object('delivery',
  (SELECT jsonb_build_object('pending',count(*) FILTER(WHERE state IN ('pending','leased') AND superseded_at IS NULL),
   'unknown',count(*) FILTER(WHERE state='unknown'),'exhausted',count(*) FILTER(WHERE state='exhausted'))
   FROM rr_sandbox.case_alert_outbox q WHERE q.case_id=h.case_id)) ORDER BY h.case_id),'[]'::jsonb) INTO cases FROM
  (SELECT * FROM rr_sandbox.case_alert_heads WHERE p_after_case IS NULL OR case_id>p_after_case ORDER BY case_id LIMIT p_limit) h;
 SELECT count(*) FILTER(WHERE state IN ('pending','leased') AND superseded_at IS NULL),count(*) FILTER(WHERE state='unknown'),count(*) FILTER(WHERE state='exhausted')
 INTO pending,unknown,exhausted FROM rr_sandbox.case_alert_outbox;
 RETURN jsonb_build_object('test',true,'cloudReady',false,'releaseEnabled',false,'cases',cases,'hasMore',total>p_limit,
  'nextCaseCursor',CASE WHEN total>p_limit THEN cases->(jsonb_array_length(cases)-1)->>'caseId' ELSE NULL END,
  'delivery',jsonb_build_object('pending',pending,'unknown',unknown,'exhausted',exhausted));
END $$;
CREATE FUNCTION public.rr_test_claim_case_alerts(p_worker uuid,p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.case_alert_outbox; output jsonb:='[]';
BEGIN
 IF p_worker IS NULL OR p_worker='00000000-0000-0000-0000-000000000000' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Bounded worker claim required'; END IF;
 PERFORM rr_sandbox.refresh_case_alerts();
 FOR q IN SELECT * FROM rr_sandbox.case_alert_outbox WHERE state='pending' AND superseded_at IS NULL AND attempts<5 AND next_attempt_at<=clock_timestamp()
  ORDER BY severity DESC,created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  UPDATE rr_sandbox.case_alert_outbox SET state='leased',attempts=attempts+1,worker_id=p_worker,lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '90 seconds'
   WHERE id=q.id RETURNING * INTO q;
  output:=output||jsonb_build_array(jsonb_build_object('alertId',q.id,'deliveryKey','rr_test_case_alert_'||q.id,
   'leaseToken',q.lease_token,'leasedUntil',q.leased_until,'attempt',q.attempts,'kind',q.kind,'severity',q.severity,'case',q.snapshot));
 END LOOP;
 RETURN jsonb_build_object('test',true,'cloudReady',false,'releaseEnabled',false,'alerts',output);
END $$;
CREATE FUNCTION public.rr_test_case_alert_authority(p_alert bigint,p_worker uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.case_alert_outbox; allowed boolean;
BEGIN
 SELECT * INTO q FROM rr_sandbox.case_alert_outbox WHERE id=p_alert;
 allowed:=FOUND AND q.state='leased' AND q.worker_id=p_worker AND q.lease_token=p_lease AND q.leased_until>clock_timestamp()
  AND q.superseded_at IS NULL AND EXISTS(SELECT 1 FROM rr_sandbox.case_alert_heads h WHERE h.case_id=q.case_id AND h.generation=q.generation);
 RETURN jsonb_build_object('test',true,'allowed',coalesce(allowed,false),'releaseEnabled',false);
END $$;
CREATE FUNCTION public.rr_test_finish_case_alert(p_alert bigint,p_worker uuid,p_lease uuid,p_outcome text,p_delivery_reference text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.case_alert_outbox; a rr_sandbox.case_alert_delivery_audit; retry boolean;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('delivered','temporary_failure','permanent_failure','outcome_unknown')
  OR p_outcome='delivered' AND p_delivery_reference IS NULL
  OR p_delivery_reference IS NOT NULL AND p_delivery_reference !~ '^[A-Za-z][A-Za-z0-9:_-]{0,127}$' THEN RAISE EXCEPTION 'Minimal delivery outcome required'; END IF;
 SELECT * INTO q FROM rr_sandbox.case_alert_outbox WHERE id=p_alert FOR UPDATE;
 IF NOT FOUND OR p_worker IS NULL OR p_lease IS NULL OR q.worker_id IS DISTINCT FROM p_worker OR q.lease_token IS DISTINCT FROM p_lease OR q.attempts<1 THEN RAISE EXCEPTION 'Matching alert lease required'; END IF;
 SELECT * INTO a FROM rr_sandbox.case_alert_delivery_audit WHERE alert_id=q.id AND attempt=q.attempts AND outcome NOT IN ('lease_expired','outcome_conflict')
  ORDER BY CASE WHEN outcome='delivered' THEN 0 ELSE 1 END,recorded_at LIMIT 1;
 IF FOUND THEN
  IF a.outcome=p_outcome AND a.delivery_reference IS NOT DISTINCT FROM p_delivery_reference THEN
   RETURN jsonb_build_object('test',true,'duplicate',true,'state',q.state,'releaseEnabled',false);
  END IF;
  -- Read-only provider reconciliation may establish the original unknown send
  -- as delivered. It cannot create another send or attach a foreign reference.
  IF NOT(a.outcome='outcome_unknown' AND p_outcome='delivered' AND q.state='unknown'
   AND (a.delivery_reference IS NULL OR a.delivery_reference=p_delivery_reference)) THEN
   INSERT INTO rr_sandbox.case_alert_delivery_audit(alert_id,attempt,outcome) VALUES(q.id,q.attempts,'outcome_conflict') ON CONFLICT DO NOTHING;
   UPDATE rr_sandbox.case_alert_outbox SET state='unknown',last_failure='outcome_conflict' WHERE id=q.id;
   RETURN jsonb_build_object('test',true,'duplicate',false,'state','unknown','needsReview',true,'releaseEnabled',false);
  END IF;
 END IF;
 INSERT INTO rr_sandbox.case_alert_delivery_audit(alert_id,attempt,outcome,delivery_reference) VALUES(q.id,q.attempts,p_outcome,p_delivery_reference);
 retry:=p_outcome='temporary_failure' AND q.attempts<5 AND q.superseded_at IS NULL AND q.leased_until>clock_timestamp();
 UPDATE rr_sandbox.case_alert_outbox SET
  state=CASE WHEN p_outcome='delivered' THEN 'delivered' WHEN p_outcome='outcome_unknown' THEN 'unknown' WHEN q.superseded_at IS NOT NULL THEN 'superseded' WHEN retry THEN 'pending' ELSE 'exhausted' END,
  next_attempt_at=CASE WHEN retry THEN clock_timestamp()+CASE q.attempts WHEN 1 THEN interval '30 seconds' WHEN 2 THEN interval '2 minutes' WHEN 3 THEN interval '10 minutes' ELSE interval '30 minutes' END ELSE next_attempt_at END,
  delivered_at=CASE WHEN p_outcome='delivered' THEN clock_timestamp() ELSE delivered_at END,delivery_reference=p_delivery_reference,
  last_failure=CASE WHEN p_outcome='delivered' THEN NULL ELSE p_outcome END
 WHERE id=q.id RETURNING * INTO q;
 RETURN jsonb_build_object('test',true,'duplicate',false,'state',q.state,'releaseEnabled',false);
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.case_alert_severity(boolean,timestamptz),rr_sandbox.case_alert_projection(rr_sandbox.case_alert_heads),rr_sandbox.enqueue_case_alert(rr_sandbox.case_alert_heads,text,integer),rr_sandbox.capture_case_alert(rr_sandbox.provider_risk_notices),rr_sandbox.capture_case_alert_trigger(),rr_sandbox.refresh_case_alerts() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rr_test_case_alert_queue(integer,text),public.rr_test_claim_case_alerts(uuid,integer),public.rr_test_case_alert_authority(bigint,uuid,uuid),public.rr_test_finish_case_alert(bigint,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_case_alert_queue(integer,text),public.rr_test_claim_case_alerts(uuid,integer),public.rr_test_case_alert_authority(bigint,uuid,uuid),public.rr_test_finish_case_alert(bigint,uuid,uuid,text,text) TO service_role;
COMMIT;

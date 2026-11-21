-- CLOSED SOURCE PROPOSAL ONLY. NOT an automatic migration or live authority.
-- Depends on existing orders, case_alert_heads and command_owner_session.
-- No existing table/Auth grants, holds, queues, clocks or delivery records change.
BEGIN;
CREATE TABLE rr_sandbox.command_case_ack (
 owner_id uuid NOT NULL,
 case_id text NOT NULL REFERENCES rr_sandbox.case_alert_heads(case_id),
 order_id uuid NOT NULL REFERENCES rr_sandbox.orders(id),
 generation bigint NOT NULL CHECK(generation>0),
 evidence_version text NOT NULL CHECK(evidence_version ~ '^[a-f0-9]{64}$'),
 first_request uuid NOT NULL,
 first_session uuid NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,case_id,generation,evidence_version)
);
CREATE TABLE rr_sandbox.command_case_ack_request (
 owner_id uuid NOT NULL, request_id uuid NOT NULL, command jsonb NOT NULL,
 case_id text NOT NULL, generation bigint NOT NULL, evidence_version text NOT NULL,
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,case_id,generation,evidence_version)
 REFERENCES rr_sandbox.command_case_ack(owner_id,case_id,generation,evidence_version)
);
ALTER TABLE rr_sandbox.command_case_ack ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.command_case_ack_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.command_case_ack,rr_sandbox.command_case_ack_request FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rr_sandbox.command_ack_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Command acknowledgements are immutable'; END $$;
CREATE TRIGGER command_ack_immutable BEFORE UPDATE OR DELETE ON rr_sandbox.command_case_ack
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.command_ack_immutable();
CREATE TRIGGER command_ack_request_immutable BEFORE UPDATE OR DELETE ON rr_sandbox.command_case_ack_request
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.command_ack_immutable();
CREATE FUNCTION rr_sandbox.command_case_version(h rr_sandbox.case_alert_heads) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(h.order_id,h.kind,h.generation,h.evidence_hash,
 h.amount_cents,h.provider_status,h.requires_response,h.evidence_conflict,extract(epoch FROM h.due_by),
 extract(epoch FROM h.provider_due_by),h.latest_event_created,h.latest_event_id)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION rr_sandbox.command_ack_projection(a rr_sandbox.command_case_ack) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('ownerId',a.owner_id,'caseRef','case_'||md5(a.case_id),'orderRef',a.order_id,
 'generation',a.generation,'evidenceVersion',a.evidence_version,'firstRequestId',a.first_request,
 'acknowledgedAt',a.acknowledged_at)
$$;
CREATE FUNCTION rr_sandbox.command_queue_rows(p_owner uuid,p_kind text) RETURNS TABLE(ref text,record jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT o.id::text,jsonb_build_object('orderRef',o.id,'state',o.state,'riskStatus',o.risk_status,
 'refundState',o.refund_state,'totalCents',coalesce((o.snapshot->>'totalCents')::bigint,o.item_cents+o.buyer_fee_cents),
 'observedAt',o.updated_at,'holdRequired',true)
 FROM rr_sandbox.orders o WHERE p_kind='orders' AND o.test IS TRUE
 UNION ALL
 SELECT 'case_'||md5(h.case_id),jsonb_build_object('caseRef','case_'||md5(h.case_id),'orderRef',h.order_id,
 'kind',h.kind,'status',CASE WHEN h.evidence_conflict THEN 'conflicting_evidence' ELSE h.provider_status END,
 'requiresResponse',h.requires_response,'dueBy',h.due_by,'observedAt',h.observed_at,'holdRequired',true,
 'generation',h.generation,'evidenceVersion',rr_sandbox.command_case_version(h),
 'acknowledgement',(SELECT rr_sandbox.command_ack_projection(a) FROM rr_sandbox.command_case_ack a
 WHERE a.owner_id=p_owner AND a.case_id=h.case_id AND a.generation=h.generation AND a.evidence_version=rr_sandbox.command_case_version(h)))
 FROM rr_sandbox.case_alert_heads h JOIN rr_sandbox.orders o ON o.id=h.order_id
 WHERE p_kind='cases' AND o.test IS TRUE
$$;
CREATE FUNCTION rr_sandbox.command_queue_action(p_owner uuid,p_session uuid,p_token_exp bigint,p_nonce uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' SET lock_timeout='2s' SET statement_timeout='4s' AS $$
DECLARE
 authorized_owner CONSTANT uuid := NULL;
 enabled_from CONSTANT timestamptz := NULL;
 enabled_until CONSTANT timestamptz := NULL;
 observed timestamptz:=clock_timestamp(); result jsonb; body jsonb; k text; f text; rev text;
 rows_json jsonb; page jsonb; more boolean; requested uuid; h rr_sandbox.case_alert_heads;
 a rr_sandbox.command_case_ack; r rr_sandbox.command_case_ack_request; expected text; v text;
BEGIN
 IF authorized_owner IS NULL OR p_owner IS DISTINCT FROM authorized_owner OR enabled_from IS NULL OR enabled_until IS NULL
 OR enabled_until<=enabled_from OR observed<enabled_from OR observed>=enabled_until THEN RAISE EXCEPTION 'Command queue closed'; END IF;
 IF (rr_sandbox.command_owner_session(p_owner,p_owner,p_session,p_token_exp,p_nonce)->>'accepted')::boolean IS NOT TRUE
 THEN RAISE EXCEPTION 'Current owner session required'; END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('list','lookup','ack','receipt') OR p_args IS NULL OR jsonb_typeof(p_args)<>'object'
 THEN RAISE EXCEPTION 'Invalid command queue request'; END IF;
 IF p_operation IN ('list','lookup') THEN
  k:=p_args->>'kind';
  IF k IS NULL OR k NOT IN ('orders','cases') THEN RAISE EXCEPTION 'Invalid queue kind'; END IF;
  IF p_operation='list' THEN
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_args) key) IS DISTINCT FROM ARRAY['after','filter','kind','revision']::text[]
   OR (p_args->>'filter') IS NULL OR p_args->>'filter' NOT IN ('all',CASE WHEN k='orders' THEN 'held' ELSE 'attention' END)
   OR (p_args->>'after' IS NULL) IS DISTINCT FROM (p_args->>'revision' IS NULL)
   OR p_args->>'after' IS NOT NULL AND ((k='orders' AND p_args->>'after' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') OR (k='cases' AND p_args->>'after' !~ '^case_[a-f0-9]{32}$'))
   THEN RAISE EXCEPTION 'Invalid queue page'; END IF;
   f:=p_args->>'filter';
   -- One statement snapshot, immutable reference ordering. A changed inventory
   -- rejects continuation; never silently skip/repeat rows across revisions.
   SELECT coalesce(jsonb_agg(record ORDER BY ref COLLATE "C"),'[]'::jsonb) INTO rows_json
   FROM rr_sandbox.command_queue_rows(p_owner,k) WHERE f='all'
    OR f='held' AND record->>'state' NOT IN ('expired','payment_failed','cancelled')
    OR f='attention' AND ((record->>'requiresResponse')::boolean OR record->>'status'='conflicting_evidence');
   rev:=encode(sha256(convert_to(rows_json::text,'UTF8')),'hex');
   IF p_args->>'revision' IS NOT NULL AND p_args->>'revision'<>rev THEN RAISE EXCEPTION 'Queue revision changed'; END IF;
   SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO page FROM
    (SELECT value,ordinality FROM jsonb_array_elements(rows_json) WITH ORDINALITY
     WHERE p_args->>'after' IS NULL OR (value->>CASE WHEN k='orders' THEN 'orderRef' ELSE 'caseRef' END) COLLATE "C">(p_args->>'after') COLLATE "C"
     ORDER BY ordinality LIMIT 26) q;
   more:=jsonb_array_length(page)>25;
   IF more THEN page:=page-25; END IF;
   body:=jsonb_build_object('kind',k,'filter',f,'revision',rev,'items',page,'hasMore',more,
    'nextAfter',CASE WHEN more THEN page->24->>CASE WHEN k='orders' THEN 'orderRef' ELSE 'caseRef' END ELSE NULL END);
  ELSE
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_args) key) IS DISTINCT FROM ARRAY['kind','ref']::text[]
   OR p_args->>'ref' IS NULL OR (k='orders' AND p_args->>'ref' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
   OR (k='cases' AND p_args->>'ref' !~ '^case_[a-f0-9]{32}$') THEN RAISE EXCEPTION 'Invalid exact reference'; END IF;
   SELECT record INTO result FROM rr_sandbox.command_queue_rows(p_owner,k) WHERE ref=p_args->>'ref';
   body:=jsonb_build_object('kind',k,'ref',p_args->>'ref','item',result);
  END IF;
 ELSE
  IF p_args->>'requestId' IS NULL OR p_args->>'requestId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  THEN RAISE EXCEPTION 'Original request required'; END IF;
  requested:=(p_args->>'requestId')::uuid;
  IF requested='00000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'Original request required'; END IF;
  IF p_operation='ack' THEN
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_args) key) IS DISTINCT FROM ARRAY['caseRef','evidenceVersion','generation','orderRef','requestId']::text[]
   OR p_args->>'caseRef' IS NULL OR p_args->>'caseRef' !~ '^case_[a-f0-9]{32}$'
   OR p_args->>'orderRef' IS NULL OR p_args->>'orderRef' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   OR jsonb_typeof(p_args->'generation')<>'number' OR p_args->>'generation' !~ '^[1-9][0-9]{0,14}$'
   OR p_args->>'evidenceVersion' IS NULL OR p_args->>'evidenceVersion' !~ '^[a-f0-9]{64}$'
   THEN RAISE EXCEPTION 'Exact evidence acknowledgement required'; END IF;
   -- Serialize original request IDs even when maliciously reused for another case.
   PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||requested::text,0));
   SELECT * INTO r FROM rr_sandbox.command_case_ack_request WHERE owner_id=p_owner AND request_id=requested;
   IF FOUND THEN
    IF r.command IS DISTINCT FROM p_args THEN RAISE EXCEPTION 'Acknowledgement request conflict'; END IF;
   ELSE
    SELECT c.* INTO h FROM rr_sandbox.case_alert_heads c JOIN rr_sandbox.orders o ON o.id=c.order_id
    WHERE 'case_'||md5(c.case_id)=p_args->>'caseRef' AND o.test IS TRUE FOR UPDATE OF c;
    IF NOT FOUND OR h.order_id::text<>p_args->>'orderRef' OR h.generation<>(p_args->>'generation')::bigint
     OR rr_sandbox.command_case_version(h)<>p_args->>'evidenceVersion' THEN RAISE EXCEPTION 'Case evidence changed'; END IF;
    INSERT INTO rr_sandbox.command_case_ack(owner_id,case_id,order_id,generation,evidence_version,first_request,first_session)
    VALUES(p_owner,h.case_id,h.order_id,h.generation,rr_sandbox.command_case_version(h),requested,p_session) ON CONFLICT DO NOTHING;
    INSERT INTO rr_sandbox.command_case_ack_request(owner_id,request_id,command,case_id,generation,evidence_version)
    VALUES(p_owner,requested,p_args,h.case_id,h.generation,rr_sandbox.command_case_version(h));
   END IF;
  ELSE
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_args) key) IS DISTINCT FROM ARRAY['requestId']::text[]
   THEN RAISE EXCEPTION 'Original request lookup only'; END IF;
  END IF;
  SELECT a0.* INTO a FROM rr_sandbox.command_case_ack_request r0 JOIN rr_sandbox.command_case_ack a0
   USING(owner_id,case_id,generation,evidence_version) WHERE r0.owner_id=p_owner AND r0.request_id=requested;
  body:=jsonb_build_object('requestId',requested,'acknowledgement',CASE WHEN a.owner_id IS NOT NULL THEN rr_sandbox.command_ack_projection(a) ELSE NULL END,
   'isCurrent',coalesce(EXISTS(SELECT 1 FROM rr_sandbox.case_alert_heads c WHERE c.case_id=a.case_id AND c.order_id=a.order_id
    AND c.generation=a.generation AND rr_sandbox.command_case_version(c)=a.evidence_version),false));
 END IF;
 -- Recheck after waits/locks. A lost response may only be read by original ID.
 IF clock_timestamp()>=enabled_until OR (rr_sandbox.command_owner_session(p_owner,p_owner,p_session,p_token_exp,p_nonce)->>'accepted')::boolean IS NOT TRUE
 THEN RAISE EXCEPTION 'Current owner session required'; END IF;
 RETURN jsonb_build_object('version','rr-command-queue-v1','test',true,'live',false,'releaseEnabled',false,
 'environmentId','acceptance-v1','ownerId',p_owner,'sessionRef',p_session,'nonce',p_nonce,
 'observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'operation',p_operation,'result',body);
END $$;
CREATE FUNCTION public.rr_test_command_queue(p_owner uuid,p_session uuid,p_token_exp bigint,p_nonce uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT rr_sandbox.command_queue_action(p_owner,p_session,p_token_exp,p_nonce,p_operation,p_args)
$$;
REVOKE ALL ON FUNCTION rr_sandbox.command_ack_immutable(),rr_sandbox.command_case_version(rr_sandbox.case_alert_heads),
 rr_sandbox.command_ack_projection(rr_sandbox.command_case_ack),rr_sandbox.command_queue_rows(uuid,text),
 rr_sandbox.command_queue_action(uuid,uuid,bigint,uuid,text,jsonb),public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
-- Only these NEW finite functions. No Auth/table/other-function grant is changed.
GRANT EXECUTE ON FUNCTION rr_sandbox.command_queue_action(uuid,uuid,bigint,uuid,text,jsonb),
 public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb) TO service_role;
COMMIT;

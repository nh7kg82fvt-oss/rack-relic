"""Run the unmodified ticket SQL in a disposable, network-disabled PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time
import uuid

IMAGE = "postgres@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe"
SQL = (Path(__file__).resolve().parents[1] / "sql/schedule_ticket_v1.sql").read_text()
TABLE = "rr_sandbox.backup_schedule_ticket_v1"
READ = "public.rr_test_backup_schedule_ticket_read_v1"
CONSUME = "public.rr_test_backup_schedule_ticket_consume_v1"
FUNCTIONS = (
    "rr_sandbox.backup_schedule_ticket_no_reset_v1()",
    READ + "(uuid,text,bigint,bigint,text,text,text,text)",
    CONSUME + "(uuid,text,bigint,bigint,text,text,text,text,text,text)",
)
TICKET = "11111111-1111-4111-8111-111111111111"
NONCE = "1" * 32
OTHER = "2" * 32
CONSUMED = {"version": "rr-schedule-ticket-consumed-v1", "ticketId": TICKET, "consumed": True}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def check(condition, detail):
    if not condition:
        raise AssertionError(detail)


class Cluster:
    def __init__(self, name):
        self.name = name

    def query(self, db, sql, error=None):
        result = subprocess.run(
            ["docker", "exec", "-i", self.name, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
             "-U", "postgres", "-d", db],
            input=sql, text=True, capture_output=True, timeout=90,
        )
        if error:
            check(result.returncode != 0 and error in result.stderr, result)
        else:
            check(result.returncode == 0, result)
        return result.stdout.strip()

    def setup(self, db, prelude=""):
        self.query("postgres", f"CREATE DATABASE {db};")
        self.query(db, f"""
            CREATE SCHEMA rr_sandbox AUTHORIZATION rr_owner;
            GRANT USAGE, CREATE ON SCHEMA public TO rr_owner;
            GRANT USAGE ON SCHEMA rr_sandbox TO anon, authenticated, service_role, rr_outsider;
            SET ROLE rr_owner;
            {prelude}
        """)


def installation(pg):
    empty = f"""
        SELECT to_regclass('{TABLE}') IS NULL
          AND { ' AND '.join(f"to_regprocedure('{f}') IS NULL" for f in FUNCTIONS) };
    """
    pg.setup("acl")
    hostile_path = """
        CREATE SCHEMA shadow AUTHORIZATION rr_owner;
        CREATE FUNCTION shadow.to_regnamespace(text) RETURNS regnamespace
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SHADOW_CALLED'; END $$;
    """
    pg.query("acl", hostile_path)
    prefix = "SET ROLE rr_owner; BEGIN; SET LOCAL search_path=shadow,pg_catalog;"
    pg.query("acl", prefix + "SELECT to_regnamespace('rr_sandbox');", "SHADOW_CALLED")
    check(pg.query("acl", prefix + SQL + "SHOW search_path; ROLLBACK;" + empty)
          == "shadow, pg_catalog\nt", "search_path must be restored and rollback must remove all objects")
    pg.query("acl", "SET ROLE rr_owner;" + SQL)
    check(pg.query("acl", f"SELECT count(*) FROM {TABLE};") == "0", "install seeded a ticket")

    for role in ("rr_owner", "anon", "authenticated", "service_role", "rr_outsider"):
        privileges = [
            f"has_table_privilege('{role}','{TABLE}','{privilege}')"
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN")
        ]
        privileges += [f"has_function_privilege('{role}','{fn}','EXECUTE')" for fn in FUNCTIONS]
        expected = "t" if role == "rr_owner" else "f"
        check(pg.query("acl", "SELECT " + ", ".join(privileges) + ";").split("|")
              == [expected] * len(privileges), f"unexpected privileges for {role}")
        if role != "rr_owner":
            prefix = f"SET ROLE {role};"
            pg.query("acl", prefix + f"SELECT * FROM {TABLE};", "permission denied for table")
            pg.query("acl", prefix + f"SELECT {READ}(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);",
                     "permission denied for function")
            pg.query("acl", prefix + f"SELECT {CONSUME}(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);",
                     "permission denied for function")
    for db, grant in (
        ("hostile_table", "IN SCHEMA rr_sandbox GRANT SELECT ON TABLES"),
        ("hostile_maintain", "IN SCHEMA rr_sandbox GRANT MAINTAIN ON TABLES"),
        ("hostile_function", "IN SCHEMA public GRANT EXECUTE ON FUNCTIONS"),
    ):
        pg.setup(db, f"ALTER DEFAULT PRIVILEGES {grant} TO rr_outsider;")
        pg.query(db, "SET ROLE rr_owner;" + SQL, "SCHEDULE_TICKET_OWNER_ONLY_ACL_HELD")
        check(pg.query(db, empty) == "t", f"partial install in {db}")
    pg.setup("inherited_maintain")
    pg.query("postgres", "GRANT pg_maintain TO service_role;")
    try:
        pg.query("inherited_maintain", "SET ROLE rr_owner;" + SQL,
                 "SCHEDULE_TICKET_EFFECTIVE_PRIVILEGE_HELD")
        check(pg.query("inherited_maintain", empty) == "t", "partial install after inherited privilege")
    finally:
        pg.query("postgres", "REVOKE pg_maintain FROM service_role;")
    print("PASS owner and nonowner privileges, hostile defaults, inherited MAINTAIN, "
          "empty install, search_path and rollback", flush=True)


def fixture(slot):
    digest = ["1" * 64, "2" * 64, "3" * 64, "4" * 64]
    args = ",".join(map(literal, [TICKET, "* * * * *", slot, slot + 5000, *digest]))
    fields = ("selection", "ownerGrant", "enrollment", "custodyReview",
              "collectorGrantReview", "sourcePrincipalGrant", "lease", "signedWindowBinding")
    envelope = dict.fromkeys(fields)
    envelope["request"] = {
        "version": "rr-cf-backup-root-request-v1", "requestedAt": slot,
        "deadline": slot + 5000, "selectionSha256": digest[-1],
    }
    body = literal(json.dumps(envelope, separators=(",", ":")))
    sha = f"encode(sha256(convert_to({body},'UTF8')),'hex')"
    insert = f"""
        INSERT INTO {TABLE}(ticket_id,cron,scheduled_time,deadline,root_sha256,
          acceptance_sha256,request_sha256,selection_sha256,envelope_text,envelope_sha256)
        VALUES ({args},{body},{sha});
    """
    calls = {nonce: f"SELECT {CONSUME}({args},{sha},{literal(nonce)});" for nonce in (NONCE, OTHER)}
    return insert, calls, f"SELECT {READ}({args});"


def sleep_until(ms):
    return f"DO $$ BEGIN PERFORM pg_sleep_until(to_timestamp({ms}::numeric/1000)); END $$;"


def slot_checks(pg):
    for name in ("race", "expiry", "rollback"):
        pg.setup(name)
        pg.query(name, "SET ROLE rr_owner;" + SQL)
    now = int(pg.query("postgres", "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint;"))
    slot = ((now + 6000) // 60000 + 1) * 60000
    deadline = slot + 5000
    insert, calls, read = fixture(slot)
    owner = "SET ROLE rr_owner;"
    for name in ("race", "expiry", "rollback"):
        pg.query(name, owner + insert)
    pg.query("race", owner + insert, "duplicate key")
    for query in (
        f"UPDATE {TABLE} SET root_sha256=repeat('8',64);", f"DELETE FROM {TABLE};", f"TRUNCATE {TABLE};",
    ):
        pg.query("race", owner + query, "SCHEDULE_TICKET_IMMUTABLE")

    def race(nonce):
        result = pg.query("race", owner + sleep_until(slot + 200)
                          + "SELECT pg_backend_pid();" + calls[nonce])
        pid, claim = result.splitlines()
        return pid, json.loads(claim)

    def expiry_holder():
        observe = """
            SELECT EXISTS (
                SELECT FROM pg_stat_activity
                WHERE application_name='rr-expiry-waiter'
                  AND pg_backend_pid()=ANY(pg_blocking_pids(pid))
            );
        """
        result = pg.query("expiry", owner + "BEGIN;" + sleep_until(slot + 300)
                          + f"SELECT singleton FROM {TABLE} FOR UPDATE;"
                          + sleep_until(deadline + 5) + observe + "COMMIT;")
        check(result == "t\nt", f"expiry session did not observe the blocked waiter at release: {result!r}")

    def expiry_waiter():
        pg.query("expiry", owner + "SET application_name='rr-expiry-waiter';"
                 + sleep_until(deadline - 65) + calls[NONCE], "SCHEDULE_TICKET_SLOT_HELD")

    def rollback_and_unknown():
        output = pg.query("rollback", owner + sleep_until(slot + 200)
                          + "BEGIN;" + calls[NONCE] + "ROLLBACK;" + read)
        claim, record = map(json.loads, output.splitlines())
        check(claim["nonce"] == NONCE and record["consumed"] is False, output)
        # Discard the committed reply, simulating a caller that cannot use the
        # acknowledgment. An independent session can only see consumed.
        pg.query("rollback", owner + calls[OTHER])
        check(json.loads(pg.query("rollback", owner + calls[OTHER])) == CONSUMED,
              "same-nonce replay disclosed a receipt")
        check(json.loads(pg.query("rollback", owner + calls[NONCE])) == CONSUMED,
              "different-nonce replay disclosed a receipt")
        pg.query("rollback", owner + f"UPDATE {TABLE} SET claimed_nonce=NULL,claimed_at=NULL;",
                 "SCHEDULE_TICKET_IMMUTABLE")
        check(pg.query("rollback", owner + f"SELECT claimed_nonce FROM {TABLE};") == OTHER,
              "the durable claim changed after replay")

    print("Waiting for a real minute-aligned database slot", flush=True)
    with ThreadPoolExecutor(max_workers=5) as pool:
        racers = [pool.submit(race, nonce) for nonce in (NONCE, OTHER)]
        checks = [pool.submit(fn) for fn in (expiry_holder, expiry_waiter, rollback_and_unknown)]
        (pid1, first), (pid2, second) = [f.result() for f in racers]
        check(pid1 != pid2, "claim race used one backend")
        winners = [c for c in (first, second) if c.get("version") == "rr-schedule-ticket-claim-v1"]
        check(len(winners) == 1 and CONSUMED in (first, second), (first, second))
        winner = winners[0]
        check(winner["nonce"] == (NONCE if first == winner else OTHER)
              and slot <= winner["claimedAt"] < deadline, winner)
        for future in checks:
            future.result()
    check(pg.query("expiry", owner + f"SELECT claimed_nonce IS NULL FROM {TABLE};") == "t",
          "expired waiter persisted a claim")
    print("PASS competing backend claims, blocked expiry, rollback, discarded acknowledgment and no rearm")


def main():
    name = "rr-pg17-" + uuid.uuid4().hex
    pg = Cluster(name)
    try:
        subprocess.run(
            ["docker", "run", "--pull=never", "--rm", "--detach", "--name", name,
             "--network=none", "--tmpfs", "/var/lib/postgresql/data",
             "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE, "postgres", "-c", "listen_addresses="],
            check=True, stdout=subprocess.DEVNULL,
        )
        for _ in range(60):
            # The official entrypoint briefly runs a separate bootstrap
            # postmaster before exec'ing the final server as PID 1.
            ready = subprocess.run(
                ["docker", "exec", name, "sh", "-c",
                 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -U postgres'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("disposable PostgreSQL did not become ready")
        version = pg.query("postgres", "SHOW server_version;")
        check(version.startswith("17."), version)
        print(f"Native PostgreSQL {version}", flush=True)
        pg.query("postgres", """
            CREATE ROLE rr_owner; CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE ROLE service_role; CREATE ROLE rr_outsider;
        """)
        installation(pg)
        slot_checks(pg)
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# ============================================================================
# The session gate. The only sanctioned `git commit` and `git push` in this repo.
# ----------------------------------------------------------------------------
# WHY THIS EXISTS, in one measured fact. On 2026-09-02 a survival figure was
# measured at 2%. On 2026-09-03 it was withdrawn: 200 of the 252 sampled rows
# were a throwaway probe run named "AMEND MATRIX - safe to delete", so the
# denominator counted deletions-by-design as lost bookings. The withdrawal was
# written into two files. It never reached the one-line memory index, and on
# 2026-09-28 — twenty-five days later — that stale line put the dead number back
# at position one of the next session's plan, ahead of four real blockers.
#
# A retraction lost an argument to a summary because this repo measured things
# and had nowhere append-only to put a number. That is the whole reason for the
# file below. A number that moved without a ticket explaining it is a regression.
#
# THREE STEPS, STOPPING AT THE FIRST FAILURE:
#
#   1. Confirm   `npx tsc --noEmit` and `npm run test:all`. Red, and this exits
#                non-zero having written NOTHING. A broken state must never
#                reach the feed, because a later reader cannot tell a bad
#                measurement from a bad build.
#   2. Ticket    One entry appended to public/data/feed.json. Never rewritten,
#                never deleted; old entries may be thinned to their headlines.
#   3. Commit    Subject from -m. The body appends the headline and ticket id.
#
# THE TICKET CARRIES NO SHA, deliberately — it is committed inside the commit it
# would name. The ticket id in the commit message is the join key:
#
#     git log --grep "Ticket S-0007"
#
# THE SUITE IS `npm run test:all`, NOT `npm test`. `npm test` is `tsx test/run.ts`
# and runs exactly ONE file. The 117-file discovery runner is test/all.ts. Three
# handoffs have claimed "117 test files, npm test ALL PASS"; that sentence names
# a command which does not run them. Changing this line back re-tells that lie.
#
#   python scripts/session.py -m "subject" --headline "what moved" -- app/lib/x.ts
#   python scripts/session.py --self-test        # prove the gate can go red
#   python scripts/session.py --dry-run -m "..." # confirm + ticket preview, no write
# ============================================================================
import argparse, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "public" / "data" / "feed.json"
MEASUREMENTS = ROOT / ".tmp-data" / "gate-measurements.json"
NEG_CONTROL = ROOT / "test" / "__gate_negative_control.ts"


def run(cmd, **kw):
    """
    ENCODING IS NOT A DETAIL HERE. Windows hands subprocess cp1252 by default, the
    suite prints em-dashes, and the decode raises inside subprocess's own reader
    THREAD — which does not fail the call. The gate exits 0 and `r.stdout` comes
    back empty. That is invisible on a green run and catastrophic on a red one:
    die() prints stdout+stderr, so the first real failure this gate caught would
    have been reported with no reason attached.
    """
    return subprocess.run(cmd, cwd=ROOT, shell=True, text=True,
                          encoding="utf-8", errors="replace",
                          capture_output=True, **kw)


def die(step, detail=""):
    print(f"\nGATE FAILED at {step}. Nothing was written.", file=sys.stderr)
    if detail:
        print(detail[-4000:], file=sys.stderr)
    sys.exit(1)


def test_file_count():
    """
    A FALLBACK, and labelled as one wherever it is used.

    test/all.ts DISCOVERS its files and prints how many it ran. Re-deriving that
    number here means keeping this filter in step with NOT_A_TEST in that file by
    hand, which is the exact failure test/all.ts was written to end — and it
    already happened: the first ticket this gate wrote said 116 because this
    forgot mocks.ts while the runner ran 115. Read the runner's own count.
    """
    return len([p for p in (ROOT / "test").glob("*.ts")
                if p.name not in ("all.ts", "mocks.ts") and not p.name.startswith("__")])


def ran_count(output):
    """The number test/all.ts says it ran. None when it did not say."""
    m = re.search(r"ALL (\d+) TEST FILES PASS", output)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- 1. confirm
def confirm(skip_suite=False):
    print("confirm: npx tsc --noEmit")
    r = run("npx tsc --noEmit")
    if r.returncode != 0:
        die("typecheck", r.stdout + r.stderr)
    print("  clean")

    if skip_suite:
        return {"tsc": "clean", "suite": "SKIPPED", "test_files": test_file_count(),
                "result": "partial"}

    print(f"confirm: npm run test:all  (~{test_file_count()} test files)")
    r = run("npm run test:all")
    if r.returncode != 0:
        # WHICH FILE FAILED IS THE ONLY LINE THAT MATTERS, and the first time this
        # gate went red it was buried: the tail showed a stack trace from a test that
        # throws ON PURPOSE (venueAdjudicate proves a judge that throws falls back),
        # and the runner's own verdict line had scrolled past. Surface it first.
        out = (r.stdout or "") + (r.stderr or "")
        which = re.search(r"^\d+ of \d+ FAILED: .*$", out, re.M)
        banner = f"\n>>> {which.group(0)}\n" if which else (
            "\n>>> the runner did not print which file failed; the tail follows\n")
        die("suite", banner + out)

    ran = ran_count(r.stdout)
    if ran is None:
        die("suite", "The suite exited 0 but never printed 'ALL <n> TEST FILES PASS'.\n"
                     "Either the runner's report line changed or its output was not\n"
                     "captured. Refusing to ticket a test count nothing stated.\n\n"
                     + (r.stdout or "")[-2000:])
    print(f"  all pass ({ran} files, as reported by the runner)")
    return {"tsc": "clean", "suite": "npm run test:all", "test_files": ran,
            "test_files_source": "reported by test/all.ts", "result": "pass"}


# ------------------------------------------------- the negative control (Q4)
def self_test():
    """
    Prove the gate DETECTS failure. A gate nobody has seen go red is a gate
    nobody has any reason to believe. This writes a test file that exits 1,
    runs the real runner, and asserts the runner reports failure.

    Safe by construction: the file is written into test/, removed in a finally,
    and named so test_file_count() ignores it — a crash mid-run cannot silently
    inflate a later ticket's test count.
    """
    NEG_CONTROL.write_text(
        "// Written and deleted by scripts/session.py --self-test. If you are\n"
        "// reading this in a commit, the gate crashed mid-control: delete it.\n"
        'console.log("  FAIL  negative control: the gate must report this run red");\n'
        "process.exit(1);\n", encoding="utf-8")
    try:
        r = run("npm run test:all")
        red = r.returncode != 0
    finally:
        NEG_CONTROL.unlink(missing_ok=True)

    if not red:
        die("negative control",
            "The suite returned 0 with a deliberately failing test file present.\n"
            "The gate cannot detect failure and every green ticket it has written\n"
            "is unevidenced.")
    print("negative control: the suite went red as required")
    return {"proven_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "method": "a test file exiting 1 was added to test/; npm run test:all returned non-zero"}


# ----------------------------------------------------------------- 2. ticket
def load_feed():
    if not FEED.exists():
        return []
    return json.loads(FEED.read_text(encoding="utf-8"))


def next_id(feed):
    n = 0
    for e in feed:
        m = re.match(r"S-(\d+)$", e.get("id", ""))
        if m:
            n = max(n, int(m.group(1)))
    return f"S-{n + 1:04d}"


def take_measurements():
    """
    Numbers the gate carries but does not itself compute.

    A measurement script writes .tmp-data/gate-measurements.json and this folds
    it in, then DELETES it — so a number can never be carried twice and read as
    two independent confirmations of itself.

    Every measurement needs a denominator and a dataset label. A rate with
    neither cannot be compared to the next one, which is the only thing a feed
    is for.
    """
    if not MEASUREMENTS.exists():
        return {}, []
    blob = json.loads(MEASUREMENTS.read_text(encoding="utf-8"))
    MEASUREMENTS.unlink()
    return blob.get("measured", {}), blob.get("deferred", [])


def ticket(feed, args, confirmation, measured, deferred, control):
    e = {
        "id": next_id(feed),
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kind": args.kind,
        "headline": args.headline or args.message,
        "subject": args.message,
        "confirm": confirmation,
    }
    if measured:
        e["measured"] = measured
    if deferred:
        e["deferred"] = deferred
    if control:
        e["negative_control"] = control
    if args.source:
        e["sources"] = args.source
    return e


def append(feed, entry):
    FEED.parent.mkdir(parents=True, exist_ok=True)
    feed.append(entry)
    FEED.write_text(json.dumps(feed, indent=1) + "\n", encoding="utf-8")


# ----------------------------------------------------------------- 3. commit
def commit_and_push(args, entry):
    paths = list(args.pathspec) + [str(FEED.relative_to(ROOT)).replace("\\", "/")]
    r = run("git add -- " + " ".join(f'"{p}"' for p in paths))
    if r.returncode != 0:
        die("git add", r.stdout + r.stderr)

    body = f"{entry['headline']}\n\nTicket {entry['id']}"
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8", newline="\n") as f:
        f.write(f"{args.message}\n\n{body}\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n")
        msg = f.name
    try:
        r = run(f'git commit -F "{msg}"')
        if r.returncode != 0:
            die("git commit", r.stdout + r.stderr)
        print(r.stdout.strip().splitlines()[0] if r.stdout.strip() else "committed")
    finally:
        os.unlink(msg)

    if args.no_push:
        print("push: skipped (--no-push)")
        return
    r = run("git push")
    if r.returncode != 0:
        die("git push", r.stdout + r.stderr)
    print("pushed")


def main():
    p = argparse.ArgumentParser(description="The session gate: confirm, ticket, commit, push.")
    p.add_argument("-m", "--message", help="commit subject: one line, a fact about the software")
    p.add_argument("--headline", help="how this ticket reads in a list; defaults to the subject")
    p.add_argument("--kind", default="measurement",
                   choices=["measurement", "decision", "withdrawal", "control"])
    p.add_argument("--source", action="append", default=[],
                   help="file:line or path backing this entry; repeatable")
    p.add_argument("--self-test", action="store_true", help="prove the gate detects failure")
    p.add_argument("--dry-run", action="store_true", help="confirm and print the ticket; write nothing")
    p.add_argument("--no-push", action="store_true")
    p.add_argument("--skip-suite", action="store_true",
                   help="typecheck only. The ticket records result=partial and says so.")
    p.add_argument("pathspec", nargs="*", help="paths to commit (the feed is added automatically)")
    args = p.parse_args()

    control = self_test() if args.self_test else None

    if not args.message:
        if control:
            print("negative control proven; no -m given, so nothing was ticketed.")
            return
        p.error("-m is required unless --self-test is used alone")

    confirmation = confirm(skip_suite=args.skip_suite)
    measured, deferred = take_measurements()
    feed = load_feed()
    entry = ticket(feed, args, confirmation, measured, deferred, control)

    if args.dry_run:
        print("\n--dry-run, nothing written. The ticket would be:\n")
        print(json.dumps(entry, indent=1))
        return

    append(feed, entry)
    print(f"ticket {entry['id']} appended to {FEED.relative_to(ROOT)}")
    commit_and_push(args, entry)


if __name__ == "__main__":
    main()

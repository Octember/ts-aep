"""CI gate for the differential harness: fail unless every sample parses
identically and every edit outcome and saved file matches py-aep."""
import json, pathlib, subprocess, sys

parse = json.load(open(".diff/report.json"))
bad_parse = parse["samples"] - parse["identical"]
edit = subprocess.run([sys.executable, "tools/diff/edit_compare.py", ".diff/edit/out"], capture_output=True, text=True).stdout
summary = json.loads(edit.splitlines()[0])
print(json.dumps({"parse_samples": parse["samples"], "parse_differing": bad_parse, **summary}))
if bad_parse or summary["outcome_mismatch"] or summary["bytes_differ"] or summary["save_mismatch"] or summary["no_plan"]:
    print(edit)
    sys.exit(1)

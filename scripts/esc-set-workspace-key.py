"""Set workspace deploy SSH private key in Pulumi ESC environment.

Reads the current env definition from stdin, merges the workspace key, and
writes the updated YAML to the output file. Used by `task esc:set-workspace-key`.

Usage: pulumi env get ... | python3 esc-set-workspace-key.py <out.yaml> <priv_key>
"""

import sys
import yaml

out_file, priv_file = sys.argv[1:]

data = yaml.safe_load(sys.stdin.read()) or {}
priv = open(priv_file).read().rstrip()

data.setdefault("values", {})
data["values"].setdefault("pulumiConfig", {})
data["values"]["pulumiConfig"]["openclaw:workspaceSshPrivateKey"] = {"fn::secret": priv}

with open(out_file, "w") as f:
    yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False, width=float("inf"))

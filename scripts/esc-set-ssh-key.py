"""Set Hetzner SSH keypair in Pulumi ESC environment.

Reads the current env definition from stdin, merges the SSH keys, and writes
the updated YAML to the output file. Used by `task esc:set-ssh-key`.

Usage: pulumi env get ... | python3 esc-set-ssh-key.py <out.yaml> <pub_key> <priv_key>
"""

import sys
import yaml

out_file, pub_file, priv_file = sys.argv[1:]

data = yaml.safe_load(sys.stdin.read()) or {}
pub = open(pub_file).read().strip()
priv = open(priv_file).read().rstrip()

data.setdefault("values", {})
data["values"].setdefault("pulumiConfig", {})
data["values"]["pulumiConfig"]["openclaw:sshPublicKey"] = pub
data["values"]["pulumiConfig"]["openclaw:sshPrivateKey"] = {"fn::secret": priv}

with open(out_file, "w") as f:
    yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False, width=float("inf"))

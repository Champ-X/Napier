# Optional Python debugger image

Build the normal Napier sandbox first. Use its immutable image ID or repository
digest as `NAPIER_SANDBOX_IMAGE`; do not use a mutable tag for the base argument.
This extension uses the base image's Python and installs a hash-pinned universal
debugpy wheel. It does not alter the default sandbox selection or its receipts.

Prepare a temporary build directory containing this Dockerfile and the wheel:

```sh
python3 -m pip download --require-hashes --no-deps --only-binary=:all: \
  --platform any --implementation py --abi none \
  -r docker/napier-sandbox/python-debugger/requirements.lock -d /tmp/napier-debugpy-build
cp docker/napier-sandbox/python-debugger/Dockerfile /tmp/napier-debugpy-build/Dockerfile
docker build --build-arg NAPIER_SANDBOX_IMAGE=sha256:YOUR_BASE_IMAGE_ID \
  -t napier-sandbox-python-debugger /tmp/napier-debugpy-build
```

Select the resulting immutable image through the existing sandbox configuration.
Python DAP runs in one read-only container with `--network none`: adapter and
program communicate over container-local loopback, with no published host port
or outbound network capability. The adapter binds executable, package, image,
local daemon and user identities. A host `.venv` is not used by this image runtime.

The workspace remains read-only during debugging. Stop the debugger before
applying code edits. Python inspection and evaluation are execution, and retain
write-effect admission even with filesystem/network isolation. The image needs
separate release qualification before it can become a default or a published
release artifact.

/** Executed inside the selected immutable image, without host mounts or network. */
export const PYTHON_DEBUGGER_PROBE_SOURCE = String.raw`
import debugpy, hashlib, json, os, socket, sys
root = os.path.dirname(os.path.realpath(debugpy.__file__))
entries = []
total = 0
def visit(directory):
    global total
    for name in sorted(os.listdir(directory)):
        file = os.path.join(directory, name)
        if os.path.islink(file):
            raise ValueError("debugpy symlink")
        if os.path.isdir(file):
            visit(file)
        elif os.path.isfile(file):
            total += os.stat(file).st_size
            if len(entries) >= 2048 or total > 64 * 1024 * 1024:
                raise ValueError("debugpy asset limit")
            with open(file, 'rb') as stream:
                entries.append([os.path.relpath(file, root), hashlib.sha256(stream.read()).hexdigest()])
        else:
            raise ValueError("debugpy non-file asset")
visit(root)
if not entries:
    raise ValueError("empty debugpy package")
with socket.socket() as transport:
    transport.bind(('127.0.0.1', 0))
    transport.listen(1)
with open(os.path.realpath(sys.executable), 'rb') as executable:
    executable_hash = hashlib.sha256(executable.read()).hexdigest()
print(json.dumps(dict(executable=os.path.realpath(sys.executable), executableSha256=executable_hash,
    pythonVersion=sys.version.split()[0], debugpyRoot=root, debugpyVersion=debugpy.__version__,
    packageSha256=hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest(),
    loopback=True)))
`;

/** Parsed with the isolated interpreter; workspace modules are never imported.
 * Keep this bounded script below the governed inline-command byte limit. */
export const PYTHON_TEST_GRAPH_SCRIPT = String.raw`
import ast, hashlib, json, os, sys
root = os.path.realpath(os.getcwd())
changed = json.loads(CHANGED_JSON)
skip = {'.git', '.napier', 'node_modules', '.venv', 'venv', '__pycache__', '.tox', '.pytest_cache'}
sources, modules, edges, issues = {}, {}, set(), set()
total = 0
for directory, dirs, files in os.walk(root, followlinks=False):
    if any(d not in skip and os.path.islink(os.path.join(directory, d)) for d in dirs):
        issues.add('symlink_source')
    dirs[:] = sorted(d for d in dirs if d not in skip and not os.path.islink(os.path.join(directory, d)))
    for name in sorted(files):
        if not name.endswith('.py'): continue
        absolute = os.path.join(directory, name)
        relative = os.path.relpath(absolute, root).replace(os.sep, '/')
        if os.path.islink(absolute):
            issues.add('symlink_source'); continue
        size = os.stat(absolute).st_size
        if len(sources) >= 512 or size > 262144 or total + size > 2097152:
            issues.add('scan_limit'); continue
        data = open(absolute, 'rb').read(262145)
        total += len(data)
        try: tree = ast.parse(data, filename=relative)
        except (SyntaxError, UnicodeError):
            issues.add('parse_error'); tree = None
        sources[relative] = (hashlib.sha256(data).hexdigest(), tree)
        module = relative[:-3].replace('/', '.')
        if module.endswith('.__init__'): module = module[:-9]
        aliases = [module]
        if module.startswith('src.'): aliases.append(module[4:])
        for alias in aliases: modules.setdefault(alias, set()).add(relative)
        if name == 'setup.py': issues.add('executable_package_configuration')
def connect(importer, module):
    found = modules.get(module, set())
    if len(found) > 1: issues.add('ambiguous_module')
    for target in found: edges.add((importer, target))
    parts = module.split('.')
    for i in range(1, len(parts)):
        for parent in modules.get('.'.join(parts[:i]), set()):
            if parent.endswith('/__init__.py'): edges.add((importer, parent))
    return bool(found)
for importer, (_, tree) in sources.items():
    if tree is None: continue
    package = importer.split('/')[:-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                connect(importer, alias.name)
                if alias.name.split('.')[0] in {'importlib', 'runpy', 'pkgutil'}:
                    issues.add('dynamic_code_or_import')
                if alias.name == 'sys' and alias.asname: issues.add('dynamic_search_path')
        if isinstance(node, ast.ImportFrom):
            if (node.module or '').split('.')[0] in {'importlib', 'runpy', 'pkgutil'}:
                issues.add('dynamic_code_or_import')
            if node.module == 'sys' and any(a.name in {'path', '*'} for a in node.names):
                issues.add('dynamic_search_path')
            if node.level:
                if node.level > len(package):
                    issues.add('unresolved_relative_import'); continue
                base = package[:len(package)-node.level+1]
                if node.module: base += node.module.split('.')
                module = '.'.join(base)
            else: module = node.module or ''
            resolved = connect(importer, module)
            for alias in node.names:
                if alias.name != '*': resolved = connect(importer, module+'.'+alias.name) or resolved
            if node.level and not resolved: issues.add('unresolved_relative_import')
        if isinstance(node, ast.Call):
            name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ''
            if name in {'__import__', 'import_module', 'exec', 'eval', 'spec_from_file_location'}:
                issues.add('dynamic_code_or_import')
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'sys' and node.attr == 'path':
            issues.add('dynamic_search_path')
        if len(edges) > 4096:
            issues.add('edge_limit'); break
    if len(edges) > 4096: break
reverse = {}
for importer, target in edges: reverse.setdefault(target, set()).add(importer)
reachable, queue = set(changed), list(changed)
while queue:
    for importer in reverse.get(queue.pop(), set()):
        if importer not in reachable: reachable.add(importer); queue.append(importer)
tests = sorted(p for p in reachable if p in sources and (os.path.basename(p).startswith('test_') or p.endswith('_test.py')))
if any(os.path.basename(p) == 'conftest.py' for p in reachable):
    issues.add('shared_test_configuration')
if any(p not in sources or os.path.basename(p) in {'conftest.py', 'setup.py', '__init__.py'} for p in changed):
    issues.add('configuration_or_package_change')
if len(tests) > 8: issues.add('test_limit')
fingerprint = {'files': sorted((p, s[0]) for p, s in sources.items()), 'edges': sorted(edges)}
print(json.dumps({'selectedTests': tests[:8], 'complete': not issues, 'issues': sorted(issues),
    'scannedFileCount': len(sources), 'candidateTestCount': len(tests),
    'graphSha256': hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()}))
`;

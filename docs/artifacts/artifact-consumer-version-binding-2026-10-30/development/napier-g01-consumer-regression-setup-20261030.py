from pathlib import Path
s=Path('/tmp/napier-artifact-facts-verify-20261030.py').read_text()
s=s.replace('/tmp/napier-artifact-facts-verify-20261030','/tmp/napier-g01-consumer-integrated-20261030').replace('/tmp/napier-artifact-facts-source-stage-20261030.json','/tmp/napier-g01-consumer-source-stage-20261030.json')
s=s.replace("runtime=selected('packages/runtime/test',r'^(task-", "runtime=selected('packages/runtime/test',r'^(conversation-artifact|subagent-child-run-projection|task-")
s=s.replace("r'^(task-deliverable|plan-", "r'^(artifact-consumer|task-deliverable|plan-")
s=s.replace("r'^(task-(validation", "r'^(Artifact|ConversationArtifactCard|TaskChangesPanel|use-plan-artifact-controller|api\\.test|conversation-feed|artifact-version|task-(validation")
s=s.replace("strict=json.loads(pathlib.Path('/tmp/napier-g01-facts-tsconfig.json').read_text().replace(str(workspace),str(root)))", "strict=json.loads((root/'strict-tests.json').read_text())")
s=s.replace("'napier.artifact-facts-regression'", "'napier.artifact-consumer-version-regression'").replace('staged artifact observation/history source/test blobs', 'staged artifact consumer and conversation provenance source/test blobs')
Path('/tmp/napier-g01-consumer-regression-20261030.py').write_text(s)

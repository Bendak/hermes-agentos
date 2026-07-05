import subprocess

with open('/opt/data/.env') as f:
    for line in f:
        if line.startswith('GITHUB_TOKEN='):
            token = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

remote_url = f"https://{token}@github.com/Bendak/hermes-agentos.git"
subprocess.run(['git', 'remote', 'set-url', 'origin', remote_url], cwd='/opt/data/agentos')
subprocess.run(['git', 'add', '-A'], cwd='/opt/data/agentos')
subprocess.run(['git', 'commit', '-m', 'ci: add explicit permissions to fix workflow annotation warning'], cwd='/opt/data/agentos')
result = subprocess.run(['git', 'push', 'origin', 'main'], cwd='/opt/data/agentos', capture_output=True, text=True)
print(result.stderr if result.stderr else result.stdout)
print(f"Return code: {result.returncode}")
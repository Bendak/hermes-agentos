import subprocess

with open('/opt/data/.env') as f:
    for line in f:
        if line.startswith('GITHUB_TOKEN='):
            token = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

remote_url = f"https://{token}@github.com/Bendak/hermes-agentos.git"
subprocess.run(['git', 'remote', 'set-url', 'origin', remote_url], cwd='/opt/data/agentos')
subprocess.run(['git', 'add', '-A'], cwd='/opt/data/agentos')
subprocess.run(['git', 'commit', '-m', 
    'Phase 3: Session Messages — Read-Only Chat Thread\n\n'
    '- Backend: get_session_messages() with pagination, chronological order\n'
    '- Backend: filters out session_meta, includes tool_calls and reasoning_content\n'
    '- Backend: GET /api/sessions/{id}/messages endpoint with 404 handling\n\n'
    '- Frontend: MessagesSection with chat thread UI\n'
    '- User bubbles (right, accent), assistant bubbles (left, surface)\n'
    '- Tool messages: full-width, monospace, collapsible\n'
    '- Reasoning: collapsible "Thinking..." blocks (italic, muted)\n'
    '- Load more pagination, auto-scroll to bottom\n'
    '- Timestamps on each message\n\n'
    '9,833 real messages across 117 sessions. Read-only (no chat sending).\n'
    'Validated: API returns chronological messages, SPA serves correctly.'], cwd='/opt/data/agentos')
result = subprocess.run(['git', 'push', 'origin', 'main'], cwd='/opt/data/agentos', capture_output=True, text=True)
print(result.stderr if result.stderr else result.stdout)
print(f"Return code: {result.returncode}")
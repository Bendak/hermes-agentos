import subprocess, os

with open('/opt/data/.env') as f:
    for line in f:
        if line.startswith('GITHUB_TOKEN='):
            token = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

remote_url = f"https://{token}@github.com/Bendak/hermes-agentos.git"
subprocess.run(['git', 'remote', 'set-url', 'origin', remote_url], cwd='/opt/data/agentos')

# Remove temp files that shouldn't be committed
for f in ['push_helper.py', 'fix.py']:
    p = f'/opt/data/agentos/{f}'
    if os.path.exists(p):
        os.remove(p)

subprocess.run(['git', 'add', '-A'], cwd='/opt/data/agentos')
subprocess.run(['git', 'commit', '-m',
    'Phase 4: Kanban Board (read-only) + Visual Identity spec\n\n'
    'Backend:\n'
    '- backend/tasks.py: list_tasks() + get_task() reading kanban.db\n'
    '- GET /api/tasks with status/assignee/include_archived filters\n'
    '- GET /api/tasks/{id} with runs, comments, parent/child links\n\n'
    'Frontend:\n'
    '- Kanban board with 5 columns (Backlog, Ready, Running, Done, Blocked)\n'
    '- Archived section (collapsible, hidden by default)\n'
    '- Task cards with assignee badges, priority dots, run count\n'
    '- Task detail page with runs, comments, task links\n'
    '- NavBar: Dashboard | Sessions | Tasks\n'
    '- 10s refetch interval\n\n'
    'Design:\n'
    '- DESIGN.md: 1031-line visual identity spec by Pixel\n'
    '- Logo: Winged Glyph (Hermes wing + forward slash)\n'
    '- Palette: dark #0B1120, teal #00E5B9, gold #F5B800\n'
    '- Typography: Inter + JetBrains Mono\n'
    '- Component guide with hex codes and Tailwind config\n\n'
    '31 real tasks from kanban.db. SPA refresh on /tasks works.'], cwd='/opt/data/agentos')
result = subprocess.run(['git', 'push', 'origin', 'main'], cwd='/opt/data/agentos', capture_output=True, text=True)
print(result.stderr if result.stderr else result.stdout)
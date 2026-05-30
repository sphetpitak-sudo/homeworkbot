#!/usr/bin/env python3

# ============================================================
# HomeworkBot Runtime Lite
# commu.md ONLY VERSION
# No DB
# No aiosqlite
# No extra dependencies
# ============================================================

import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path

# ============================================================
# CONFIG
# ============================================================

PROJECT_ROOT = Path.cwd()

COMMU = PROJECT_ROOT / "commu.md"

MAX_RETRIES = 3

MAX_TASKS = 50

MAX_CONCURRENT = 3

TASK_TIMEOUT = 900

# ============================================================
# INIT
# ============================================================

def init_commu():

    if not COMMU.exists():

        COMMU.write_text("""
# HomeworkBot Runtime

## TASKS

## LOGS
""".strip())

# ============================================================
# FILE LOCK
# ============================================================

file_lock = asyncio.Lock()

# ============================================================
# COMMU HELPERS
# ============================================================

async def append_commu(text):

    async with file_lock:

        with open(COMMU, "a") as f:

            f.write(text + "\n")

async def read_commu():

    async with file_lock:

        return COMMU.read_text()

# ============================================================
# TASK PARSER
# ============================================================

TASK_PATTERN = re.compile(
    r"\[TASK\]\s+(.+?)\n"
    r"ROLE:\s+(.+?)\n"
    r"STATUS:\s+(.+?)\n"
    r"RETRIES:\s+(\d+)\n"
    r"DEPTH:\s+(\d+)\n"
    r"DESC:\s+([\s\S]*?)\n---",
    re.MULTILINE
)

async def get_tasks():

    content = await read_commu()

    tasks = []

    for match in TASK_PATTERN.finditer(content):

        tasks.append({
            "id": match.group(1).strip(),
            "role": match.group(2).strip(),
            "status": match.group(3).strip(),
            "retries": int(match.group(4)),
            "depth": int(match.group(5)),
            "description": match.group(6).strip()
        })

    return tasks

async def create_task(
    role,
    description,
    depth=0
):

    task_id = f"TASK-{datetime.utcnow().timestamp()}"

    task = f"""
[TASK] {task_id}
ROLE: {role}
STATUS: PENDING
RETRIES: 0
DEPTH: {depth}
DESC:
{description}
---
"""

    await append_commu(task)

    return task_id

async def update_task_status(
    task_id,
    new_status
):

    async with file_lock:

        content = COMMU.read_text()

        pattern = (
            rf"(\[TASK\]\s+{re.escape(task_id)}.*?"
            rf"STATUS:\s+)(.+?)(\n)"
        )

        content = re.sub(
            pattern,
            rf"\g<1>{new_status}\g<3>",
            content,
            flags=re.DOTALL
        )

        COMMU.write_text(content)

async def increment_retry(task_id):

    async with file_lock:

        content = COMMU.read_text()

        pattern = (
            rf"(\[TASK\]\s+{re.escape(task_id)}.*?"
            rf"RETRIES:\s+)(\d+)"
        )

        match = re.search(
            pattern,
            content,
            flags=re.DOTALL
        )

        if match:

            retries = int(match.group(2)) + 1

            content = re.sub(
                pattern,
                rf"\g<1>{retries}",
                content,
                flags=re.DOTALL
            )

            COMMU.write_text(content)

# ============================================================
# LOGGING
# ============================================================

async def log(message):

    ts = datetime.utcnow().strftime("%H:%M:%S")

    await append_commu(
        f"[LOG {ts}] {message}"
    )

# ============================================================
# OPENCODE AGENT
# ============================================================

class OpenCodeAgent:

    def __init__(self, role):

        self.role = role

    async def run(self, prompt):

        system_prompt = f"""
ROLE:
{self.role}

IMPORTANT:
Return valid JSON only.

FORMAT:

{{
  "success": true,
  "summary": "",
  "next_tasks": [
    {{
      "role": "",
      "description": ""
    }}
  ]
}}

TASK:
{prompt}
"""

        proc = await asyncio.create_subprocess_exec(
            "opencode",
            "run",
            system_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:

            raise Exception(stderr.decode())

        output = stdout.decode().strip()

        return json.loads(output)

# ============================================================
# AGENTS
# ============================================================

agents = {
    "EXECUTIVE": OpenCodeAgent("EXECUTIVE"),
    "ARCHITECT": OpenCodeAgent("ARCHITECT"),
    "BACKEND": OpenCodeAgent("BACKEND"),
    "FRONTEND": OpenCodeAgent("FRONTEND"),
    "QA": OpenCodeAgent("QA"),
    "SECURITY": OpenCodeAgent("SECURITY"),
    "DEVOPS": OpenCodeAgent("DEVOPS")
}

# ============================================================
# ENGINE
# ============================================================

semaphore = asyncio.Semaphore(MAX_CONCURRENT)

async def handle_failure(task):

    if task["retries"] >= MAX_RETRIES:

        await update_task_status(
            task["id"],
            "FAILED"
        )

        await log(
            f"{task['id']} permanently failed"
        )

        return

    await increment_retry(task["id"])

    await update_task_status(
        task["id"],
        "PENDING"
    )

    await log(
        f"{task['id']} retry triggered"
    )

async def execute_task(task):

    async with semaphore:

        if task["depth"] > 8:

            await update_task_status(
                task["id"],
                "FAILED"
            )

            return

        role = task["role"]

        agent = agents.get(role)

        if not agent:

            await update_task_status(
                task["id"],
                "FAILED"
            )

            return

        print(f"🚀 {role} -> {task['id']}")

        await update_task_status(
            task["id"],
            "RUNNING"
        )

        try:

            response = await asyncio.wait_for(
                agent.run(task["description"]),
                timeout=TASK_TIMEOUT
            )

            if not response.get("success"):

                raise Exception(
                    "Agent returned failed"
                )

            await update_task_status(
                task["id"],
                "SUCCESS"
            )

            await log(
                f"{task['id']} completed"
            )

            next_tasks = response.get(
                "next_tasks",
                []
            )

            total_tasks = len(await get_tasks())

            for nt in next_tasks:

                if total_tasks >= MAX_TASKS:

                    break

                await create_task(
                    role=nt["role"],
                    description=nt["description"],
                    depth=task["depth"] + 1
                )

        except Exception as e:

            print(f"❌ {task['id']} failed")

            print(str(e))

            await handle_failure(task)

# ============================================================
# EXECUTION PLAN
# ============================================================

async def create_plan(requirement):

    executive = agents["EXECUTIVE"]

    response = await executive.run(f"""
Analyze requirement:

{requirement}

Create:
- architecture tasks
- backend tasks
- frontend tasks
- QA tasks
- security tasks
- deploy tasks

Return detailed next_tasks.
""")

    for task in response["next_tasks"]:

        await create_task(
            role=task["role"],
            description=task["description"],
            depth=1
        )

# ============================================================
# DASHBOARD
# ============================================================

async def dashboard():

    os.system("clear")

    print("""
╔══════════════════════════════════╗
║ HomeworkBot Runtime Lite        ║
║ commu.md ONLY VERSION           ║
╚══════════════════════════════════╝
""")

    tasks = await get_tasks()

    if not tasks:

        print("No tasks")

        return

    for task in tasks[-20:]:

        print(
            f"{task['status']:<10} "
            f"{task['role']:<12} "
            f"{task['id']}"
        )

# ============================================================
# MAIN LOOP
# ============================================================

async def run_pipeline(requirement):

    await create_plan(requirement)

    while True:

        tasks = await get_tasks()

        pending = [
            t for t in tasks
            if t["status"] == "PENDING"
        ]

        if not pending:

            break

        await asyncio.gather(*[
            execute_task(task)
            for task in pending
        ])

    print("\n🎉 PIPELINE COMPLETE")

# ============================================================
# MENU
# ============================================================

async def main():

    init_commu()

    while True:

        await dashboard()

        print("""
1) New Feature
2) Autonomous Mode
3) View commu.md
q) Quit
""")

        choice = input(
            "\nSelect: "
        ).strip().lower()

        if choice == "1":

            req = input(
                "\nRequirement: "
            )

            if req.strip():

                await run_pipeline(req)

        elif choice == "2":

            await run_pipeline("""
Create a production-ready feature
for HomeworkBot automatically.
""")

        elif choice == "3":

            print()

            print(await read_commu())

            input("\nEnter...")

        elif choice == "q":

            break

# ============================================================
# ENTRY
# ============================================================

if __name__ == "__main__":

    asyncio.run(main())
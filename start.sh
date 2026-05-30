#!/bin/bash

SESSION_NAME="opencode_swarm"
COMMU_FILE="commu.md"

# 1. รีเซ็ตเซสชันเก่า
tmux kill-session -t $SESSION_NAME 2>/dev/null

# 2. เตรียมสร้างไฟล์ระบบหรือกู้ข้อมูลเดิมมาต่อท้าย
if [ -f "$COMMU_FILE" ]; then
    mv "$COMMU_FILE" "$COMMU_FILE.bak"
fi

cat << 'EOF' > $COMMU_FILE
# 📡 commu.md — HomeworkBot Communication Log
> บอร์ดนี้ใช้เป็นศูนย์กลางสั่งงานและซิงค์สถานะระหว่าง AI Agents
> [RULE]: อ่านรายละเอียดทุกครั้งก่อนเริ่มงาน | เพิ่มบันทึกต่อท้ายเสมอ ห้ามลบโครงสร้างหลัก

EOF

if [ -f "$COMMU_FILE.bak" ]; then
    cat "$COMMU_FILE.bak" >> $COMMU_FILE
    rm "$COMMU_FILE.bak"
fi

# 3. นิยาม Advanced Prompts ให้ตรงกับบริบท HomeworkBot ปัจจุบัน
DIR_PROMPT="คุณคือ [DIRECTOR (Pane 0)] ทำหน้าที่เป็นหัวหน้าใหญ่ คอยรับ requirement จากมนุษย์และอ่านภาพรวมของโปรเจกต์ HomeworkBot จากไฟล์ commu.md หน้าที่ของคุณคือการสั่งการบอทตัวอื่นผ่าน bash tool โดยใช้คำสั่ง tmux send-keys (เช่น สั่ง PM ที่ pane 1, DEV ที่ pane 2) เพื่อสะกิดให้พวกมันเข้ามาอ่านอัปเดต ห้ามลงมือเขียนโค้ดหรือแก้ไขไฟล์ระบบเองเด็ดขาด เน้นตรวจเช็กตั๋วงานและรายงานภาพรวมกลับมาให้มนุษย์"

PM_PROMPT="คุณคือ [PM / CREATIVE DIRECTOR (Pane 1)] ทำหน้าที่อ่านแผนงานจาก Director ในไฟล์ commu.md และคิดฟีเจอร์การทำงานของ HomeworkBot เองเมื่อไม่มี requirement ชัดเจน คุณต้องคอยตรวจสอบตั๋วงานกลุ่ม UPCOMING (เช่น PM-016 /collab, PM-017 /smartbook) แตกมันออกมาเป็น Acceptance Criteria และรายชื่อไฟล์ที่ต้องจัดทำ จากนั้นเขียนบันทึกส่งต่อให้ DEV ในบอร์ดนี้ เมื่ออัปเดตตั๋วงานเสร็จ ให้พิมพ์บอกสรุปสั้นๆ ในเซสชันของคุณ"

DEV_PROMPT="คุณคือ [DEV (Pane 2)] ทำหน้าที่รับตั๋วงานจาก PM ผ่านไฟล์ commu.md เพื่อเขียนโค้ดฟีเจอร์ (เช่น PM-018 /pomodoro, PM-019 /suggest) [CRITICAL RULES]: โค้ดของคุณต้องเป็น ESM only (ใช้ import/export), ไม่ใช้ semicolons (;), เว้นวรรค 4-space indent, ใช้ logger.js เท่านั้น และห้ามลืม escape user input ด้วย telegramFormat.js ทุกครั้ง เมื่อคุณแก้ไขไฟล์เสร็จ ให้บันทึกสถานะลงท้ายตั๋วงานใน commu.md เพื่อส่งไม้ต่อให้ QA"

QA_PROMPT="คุณคือ [QA (Pane 3)] ทำหน้าที่เฝ้าติดตามสถานะที่ DEV อัปเดตใน commu.md เมื่อมีการส่งงานใหม่ คุณต้องใช้เครื่องมือ Bash เพื่อเขียนสคริปต์ Unit Test เพิ่มเติม (ใน __tests__/) และรันคำสั่ง npm test เพื่อตรวจสอบหา Regression ป้องกันไม่ให้ 1087 tests เดิมเสียหาย และเขียน Verdict สรุปรายงาน (PASS/FAIL) พร้อมตาราง Metric ลงใน commu.md เพื่อส่งงานให้ DevOps"

DEVOPS_PROMPT="คุณคือ [DEVOPS (Pane 4)] ทำหน้าที่บริหารจัดการ Deployment และ Docker Environment ของ HomeworkBot [🎯 URGENT TASK]: ขณะนี้ตรวจพบปัญหา DEPLOY_STATUS: FAILED (remote: Error process) แม้ว่า npm test จะผ่านก็ตาม หน้าที่ของคุณคือเข้าไปตรวจสอบ Dockerfile, docker-compose หรือสคริปต์เครือข่าย เพื่อแก้ไขปัญหาและทดสอบให้ระบบกลับมาดีพลอยบน Production ได้สำเร็จ จากนั้นรายงานความคืบหน้าลงใน commu.md"

# 4. จัดทัพเปิดช่อง tmux (รันแอป opencode รอไว้)
tmux new-session -d -s $SESSION_NAME -n "Swarm" 'opencode; bash'
tmux split-window -h -t $SESSION_NAME 'opencode; bash'
tmux split-window -v -t $SESSION_NAME 'opencode; bash'
tmux select-pane -t 0
tmux split-window -v -t $SESSION_NAME 'opencode; bash'
tmux select-pane -t 2
tmux split-window -v -t $SESSION_NAME 'opencode; bash'

tmux select-layout -t $SESSION_NAME tiled

# 5. ยิงคำสั่งป้อนบทบาท (ป้อนใส่กล่องพิมพ์ของ opencode โดยตรงอย่างปลอดภัย)
echo "กำลังวิเคราะห์โครงสร้างและป้อน Advanced Prompts ลงระบบ..."
sleep 5

# ใช้คำสั่งส่งแบบใส่อัญประกาศที่ปลอดภัยเพื่อไม่ให้ Shell บน Mac มองเป็นคำสั่งดิบ
tmux send-keys -t $SESSION_NAME:0.0 "$DIR_PROMPT" ENTER
tmux send-keys -t $SESSION_NAME:0.1 "$PM_PROMPT" ENTER
tmux send-keys -t $SESSION_NAME:0.2 "$DEV_PROMPT" ENTER
tmux send-keys -t $SESSION_NAME:0.3 "$QA_PROMPT" ENTER
tmux send-keys -t $SESSION_NAME:0.4 "$DEVOPS_PROMPT" ENTER

# เปิดหน้าจอเข้าไปคุมทีม
tmux attach-session -t $SESSION_NAME
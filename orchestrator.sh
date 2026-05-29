#!/bin/bash
# ============================================================
#  HomeworkBot Orchestrator — FULL AUTO MODE
#  พิมพ์ requirement ครั้งเดียว → วิ่งเองจนจบ
# ============================================================

SESSION="ai"
REPO_PATH="${REPO_PATH:-$(pwd)}"
COMMU="$REPO_PATH/commu.md"

R='\033[0;31m' G='\033[0;32m' Y='\033[0;33m'
B='\033[0;34m' P='\033[0;35m' C='\033[0;36m' NC='\033[0m'

PANE_PM="$SESSION:0.1"
PANE_DEV="$SESSION:0.0"
PANE_QA="$SESSION:0.2"
PANE_DEVOPS="$SESSION:0.3"

# ── poll interval (วินาที) ────────────────────────────────────
POLL=5       # เช็ค commu.md ทุก 5 วินาที
TIMEOUT=300  # รอ agent ได้สูงสุด 5 นาที ก่อน timeout

# ── ส่งข้อความผ่าน buffer (ปลอดภัยจาก glob/special chars) ───
send_to_pane() {
    local pane="$1" msg="$2"
    printf '%s' "$msg" | tmux load-buffer -
    tmux paste-buffer -t "$pane"
    tmux send-keys -t "$pane" "" Enter
    sleep 0.4
}

# ── init commu.md ─────────────────────────────────────────────
init_commu() {
    [ -f "$COMMU" ] && return
    cat > "$COMMU" << 'EOF'
# 📡 commu.md — HomeworkBot Communication Log
> ไฟล์กลางสื่อสารระหว่าง AI Agents

---
## 🔴 ACTIVE TASKS


---
## 📝 LOG

EOF
}

# ── อ่านสถานะ (fixed string grep, ไม่มี glob) ────────────────
get_status() {
    [ ! -f "$COMMU" ] && echo "NO_FILE" && return

    local pm dev qa_ok qa_fail devops success
    pm=$(grep -Fc '[PM -> DEV]' "$COMMU")
    dev=$(grep -Fc '[DEV -> QA]' "$COMMU")
    qa_ok=$(grep -Fc '[QA -> DEVOPS]' "$COMMU")
    qa_fail=$(grep -Fc 'VERDICT: FAIL' "$COMMU")
    devops=$(grep -Fc '[DEVOPS -> PM]' "$COMMU")
    success=$(grep -Fc 'DEPLOY_STATUS: SUCCESS' "$COMMU")

    [ "$success" -gt 0 ]                                    && echo "DONE"         && return
    [ "$devops"  -gt 0 ] && [ "$success" -eq 0 ]           && echo "DONE"         && return
    [ "$qa_ok"   -gt 0 ] && [ "$devops"  -eq 0 ]           && echo "NEED_DEVOPS"  && return
    [ "$qa_fail" -gt 0 ]                                    && echo "QA_FAIL"      && return
    [ "$dev"     -gt 0 ] && [ "$qa_ok"   -eq 0 ] \
                         && [ "$qa_fail" -eq 0 ]            && echo "NEED_QA"      && return
    [ "$pm"      -gt 0 ] && [ "$dev"     -eq 0 ]            && echo "NEED_DEV"     && return
    echo "IDLE"
}

# ── log orchestrator action ───────────────────────────────────
log_orch() {
    printf '\n---\n[ORCHESTRATOR] %s\naction: %s\n' \
        "$(date '+%H:%M:%S')" "$1" >> "$COMMU"
}

# ── รอจนกว่า commu.md จะมีสถานะที่ต้องการ ────────────────────
wait_for_status() {
    local want="$1"
    local label="$2"
    local elapsed=0
    echo -ne "  ${Y}⏳ รอ $label${NC}"
    while true; do
        local s
        s=$(get_status)
        # ถือว่า pass ถ้าสถานะเปลี่ยนจากที่รออยู่
        if [ "$s" = "$want" ] || [ "$s" = "DONE" ] || \
           { [ "$want" = "NEED_QA" ] && [ "$s" = "QA_FAIL" ]; } || \
           { [ "$want" = "NEED_QA" ] && [ "$s" = "NEED_DEVOPS" ]; }; then
            echo -e " ${G}✅${NC}"
            return 0
        fi
        sleep "$POLL"
        elapsed=$((elapsed + POLL))
        echo -ne "."
        if [ "$elapsed" -ge "$TIMEOUT" ]; then
            echo -e " ${R}⏰ TIMEOUT${NC}"
            return 1
        fi
    done
}

# ── FULL AUTO PIPELINE ────────────────────────────────────────
auto_pipeline() {
    local req="$1"
    echo -e "\n${P}╔══════════════════════════════════════════╗${NC}"
    echo -e "${P}║  🎯 FULL AUTO PIPELINE                    ║${NC}"
    echo -e "${P}╚══════════════════════════════════════════╝${NC}"
    echo -e "  requirement: ${C}$req${NC}\n"

    # ── STEP 1: PM ────────────────────────────────────────────
    echo -e "${P}[1/4] PM — สร้าง task${NC}"
    log_orch "TRIGGER PM"
    send_to_pane "$PANE_PM" "อ่านไฟล์ $COMMU แล้วสร้าง task ใหม่สำหรับ: $req เขียนลง commu.md ในรูปแบบ [PM -> DEV] ทันที"
    wait_for_status "NEED_DEV" "PM เขียน task" || { echo -e "${R}PM timeout${NC}"; return 1; }

    # ── STEP 2: Dev ───────────────────────────────────────────
    echo -e "${B}[2/4] Dev — implement${NC}"
    log_orch "TRIGGER DEV"
    send_to_pane "$PANE_DEV" "อ่านไฟล์ $COMMU หาหัวข้อ PM -> DEV ล่าสุด implement ตาม Acceptance Criteria ทั้งหมด เขียน [DEV -> QA] เมื่อเสร็จ"
    wait_for_status "NEED_QA" "Dev implement" || { echo -e "${R}Dev timeout${NC}"; return 1; }

    # ── STEP 3: QA ────────────────────────────────────────────
    echo -e "${Y}[3/4] QA — test${NC}"
    log_orch "TRIGGER QA"
    send_to_pane "$PANE_QA" "อ่านไฟล์ $COMMU หาหัวข้อ DEV -> QA ล่าสุด เขียน Jest test รัน npm test เขียน [QA -> DEVOPS] ถ้า PASS หรือ [QA -> PM] ถ้า FAIL"

    local qa_retries=0
    while true; do
        wait_for_status "NEED_DEVOPS" "QA test" || { echo -e "${R}QA timeout${NC}"; return 1; }
        local s
        s=$(get_status)

        if [ "$s" = "QA_FAIL" ]; then
            qa_retries=$((qa_retries + 1))
            if [ "$qa_retries" -ge 3 ]; then
                echo -e "${R}❌ QA FAIL เกิน 3 รอบ — หยุด pipeline${NC}"
                log_orch "PIPELINE STOPPED — QA FAIL x3"
                return 1
            fi
            echo -e "\n${R}❌ QA FAIL รอบที่ $qa_retries — ส่ง Dev แก้${NC}"
            log_orch "QA FAIL → RE-TRIGGER DEV (retry $qa_retries)"
            send_to_pane "$PANE_DEV" "อ่านไฟล์ $COMMU หาหัวข้อ QA -> PM ล่าสุด แก้บั๊กที่ QA รายงาน แล้วเขียน [DEV -> QA] ใหม่"
            wait_for_status "NEED_QA" "Dev แก้บั๊ก" || { echo -e "${R}Dev timeout${NC}"; return 1; }
            log_orch "RE-TRIGGER QA (retry $qa_retries)"
            send_to_pane "$PANE_QA" "อ่านไฟล์ $COMMU หาหัวข้อ DEV -> QA ล่าสุด test ใหม่อีกครั้ง"
        else
            break
        fi
    done

    # ── STEP 4: DevOps ────────────────────────────────────────
    echo -e "${R}[4/4] DevOps — deploy${NC}"
    log_orch "TRIGGER DEVOPS"
    send_to_pane "$PANE_DEVOPS" "อ่านไฟล์ $COMMU หาหัวข้อ QA -> DEVOPS ล่าสุด ทำ pre-deploy checklist และ deploy เขียน [DEVOPS -> PM] เมื่อเสร็จ"
    wait_for_status "DONE" "DevOps deploy" || { echo -e "${R}DevOps timeout${NC}"; return 1; }

    echo -e "\n${G}╔══════════════════════════════════════════╗${NC}"
    echo -e "${G}║  🎉 PIPELINE สำเร็จ!                      ║${NC}"
    echo -e "${G}╚══════════════════════════════════════════╝${NC}"
    log_orch "PIPELINE COMPLETE"
}

# ── setup tmux + opencode ─────────────────────────────────────
setup_tmux() {
    echo -e "${C}🖥️  Setup tmux '$SESSION'...${NC}"
    tmux kill-session -t "$SESSION" 2>/dev/null
    tmux new-session -d -s "$SESSION" -x 220 -y 50
    tmux split-window -t "$SESSION:0" -h
    tmux split-window -t "$SESSION:0.0" -v
    tmux split-window -t "$SESSION:0.1" -v
    tmux select-layout -t "$SESSION:0" tiled

    local dirs=("$SESSION:0.0" "$SESSION:0.1" "$SESSION:0.2" "$SESSION:0.3")
    local labels=("DEV" "PM" "QA" "DEVOPS")
    for i in "${!dirs[@]}"; do
        tmux send-keys -t "${dirs[$i]}" "cd $REPO_PATH && echo '=== ${labels[$i]} ===' && opencode" Enter
        sleep 0.5
    done
    echo -e "${G}✅ tmux ready — attach: tmux attach -t $SESSION${NC}"
}

# ── inject system context ─────────────────────────────────────
inject_prompts() {
    sleep 3
    echo -e "${P}📝 inject prompts...${NC}"

    local pm_prompt="คุณคือ Creative PM ของ HomeworkBot (Telegram bot นักเรียนไทย) repo: $REPO_PATH อ่าน commu.md ก่อนทุกครั้ง เขียน task รูปแบบ [PM -> DEV] มี TASK_ID, Acceptance Criteria, ไฟล์ที่เกี่ยวข้อง ถ้าไม่มี task ให้คิด feature ใหม่เองได้ ห้ามเขียนโค้ด"
    local dev_prompt="คุณคือ Senior JS Dev ของ HomeworkBot repo: $REPO_PATH อ่าน commu.md หาหัวข้อ PM -> DEV แล้ว implement ESM only ห้าม semicolons 4-space indent ใช้ logger.js telegramFormat.js cache Notion queries เขียน [DEV -> QA] เมื่อเสร็จ"
    local qa_prompt="คุณคือ QA Engineer ของ HomeworkBot repo: $REPO_PATH อ่าน commu.md หาหัวข้อ DEV -> QA เขียน Jest test รัน npm test ให้ผ่าน 1025+ tests เขียน [QA -> DEVOPS] VERDICT: PASS หรือ [QA -> PM] VERDICT: FAIL"
    local devops_prompt="คุณคือ DevOps ของ HomeworkBot repo: $REPO_PATH อ่าน commu.md หาหัวข้อ QA -> DEVOPS ทำ pre-deploy: npm test 100% + /health 200 OK แล้ว deploy JustRunMy.app เขียน [DEVOPS -> PM] DEPLOY_STATUS: SUCCESS หรือ FAILED"

    send_to_pane "$PANE_PM" "$pm_prompt"
    sleep 0.5
    send_to_pane "$PANE_DEV" "$dev_prompt"
    sleep 0.5
    send_to_pane "$PANE_QA" "$qa_prompt"
    sleep 0.5
    send_to_pane "$PANE_DEVOPS" "$devops_prompt"
    echo -e "${G}✅ prompts injected${NC}"
}

# ── MAIN MENU ─────────────────────────────────────────────────
main() {
    clear
    echo -e "${P}╔════════════════════════════════════════╗${NC}"
    echo -e "${P}║   🎯 HomeworkBot Orchestrator           ║${NC}"
    echo -e "${P}║      FULL AUTO MODE                     ║${NC}"
    echo -e "${P}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${C}1)${NC} 🚀 Setup tmux + OpenCode ทุก pane"
    echo -e "  ${C}2)${NC} 💡 พิมพ์ requirement → วิ่งเองจนจบ"
    echo -e "  ${C}3)${NC} 🤖 ให้ PM คิด feature เองอัตโนมัติ"
    echo -e "  ${C}4)${NC} 📊 สถานะ pipeline"
    echo -e "  ${C}5)${NC} 🔄 สั่ง agent เฉพาะตัว (manual)"
    echo -e "  ${C}6)${NC} 📝 เปิด commu.md"
    echo -e "  ${C}q)${NC} ออก"
    echo ""
    echo -ne "  เลือก: "
    read -r choice

    case "$choice" in
        1)
            init_commu
            setup_tmux
            inject_prompts
            ;;
        2)
            init_commu
            echo -ne "\n  📝 requirement: "
            read -r req
            auto_pipeline "$req"
            ;;
        3)
            init_commu
            auto_pipeline "คิด feature ใหม่ที่มีประโยชน์สำหรับนักเรียนไทย แล้วพัฒนาเลย ไม่ต้องถาม"
            ;;
        4)
            echo -e "\n  สถานะ: ${Y}$(get_status)${NC}\n"
            tail -40 "$COMMU" 2>/dev/null || echo "  ไม่พบ commu.md"
            ;;
        5)
            echo -e "\n  ${C}1)PM  2)Dev  3)QA  4)DevOps${NC}"
            echo -ne "  ส่งไป: "
            read -r t
            echo -ne "  ข้อความ: "
            read -r m
            case "$t" in
                1) send_to_pane "$PANE_PM" "$m" ;;
                2) send_to_pane "$PANE_DEV" "$m" ;;
                3) send_to_pane "$PANE_QA" "$m" ;;
                4) send_to_pane "$PANE_DEVOPS" "$m" ;;
            esac
            echo -e "${G}✅ ส่งแล้ว${NC}"
            ;;
        6)
            "${EDITOR:-nano}" "$COMMU"
            ;;
        q|Q)
            echo -e "${Y}👋 bye${NC}"; exit 0 ;;
    esac

    echo ""
    echo -ne "  กด Enter กลับ menu..."
    read -r
    main
}

init_commu
main

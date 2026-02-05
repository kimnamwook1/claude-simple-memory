#!/usr/bin/env node
/**
 * prompt-hook.js
 * UserPromptSubmit Hook - 사용자 메시지를 직접 캡처하여 버퍼에 저장
 *
 * 이게 핵심! 툴 사용 여부와 관계없이 모든 사용자 질문/요청을 기록함
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 설정
const DATA_DIR = path.join(os.homedir(), '.claude-simple-memory');
const BUFFER_FILE = path.join(DATA_DIR, 'buffer.json');
const MAX_MESSAGE_LENGTH = 500; // 메시지 최대 길이

// 데이터 디렉토리 생성
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 버퍼 파일 로드
function loadBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      return JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf-8'));
    }
  } catch (e) {
    // 손상된 파일이면 새로 시작
  }
  return {
    observations: [],
    conversations: [],  // 대화 기록 추가
    session_start: new Date().toISOString()
  };
}

// 버퍼 파일 저장
function saveBuffer(buffer) {
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(buffer, null, 2), 'utf-8');
}

// 문자열을 최대 길이로 자르기
function truncate(str, maxLen = MAX_MESSAGE_LENGTH) {
  if (!str) return '';
  str = String(str).trim();
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// 메시지 타입 분류
function classifyMessage(message) {
  const lower = message.toLowerCase();

  // 질문 패턴
  if (message.includes('?') ||
      lower.includes('뭐') || lower.includes('어떻게') ||
      lower.includes('왜') || lower.includes('언제') ||
      lower.includes('what') || lower.includes('how') ||
      lower.includes('why') || lower.includes('when')) {
    return 'question';
  }

  // 요청 패턴
  if (lower.includes('해줘') || lower.includes('해주세요') ||
      lower.includes('만들어') || lower.includes('수정') ||
      lower.includes('추가') || lower.includes('삭제') ||
      lower.includes('please') || lower.includes('create') ||
      lower.includes('fix') || lower.includes('add') ||
      lower.includes('update') || lower.includes('delete')) {
    return 'request';
  }

  // 피드백/반응 패턴
  if (lower.includes('좋아') || lower.includes('됐어') ||
      lower.includes('아니') || lower.includes('다시') ||
      lower.includes('ㅋ') || lower.includes('ㅎ') ||
      lower.includes('ok') || lower.includes('good') ||
      lower.includes('no') || lower.includes('wrong')) {
    return 'feedback';
  }

  return 'statement';
}

// 메인 함수
async function main() {
  try {
    // stdin에서 hook 데이터 읽기
    const input = fs.readFileSync(0, 'utf-8');
    const hookData = JSON.parse(input);

    ensureDataDir();

    // 사용자 메시지 추출
    const userMessage = hookData.prompt || hookData.message || '';

    if (!userMessage || userMessage.trim().length === 0) {
      console.log(JSON.stringify({ success: true }));
      process.exit(0);
    }

    const buffer = loadBuffer();

    // conversations 배열이 없으면 생성
    if (!buffer.conversations) {
      buffer.conversations = [];
    }

    // 대화 기록 추가
    const conversation = {
      role: 'user',
      message: truncate(userMessage),
      type: classifyMessage(userMessage),
      timestamp: new Date().toISOString(),
      project: path.basename(hookData.cwd || process.cwd())
    };

    buffer.conversations.push(conversation);

    // 최대 50개 대화만 유지
    if (buffer.conversations.length > 50) {
      buffer.conversations = buffer.conversations.slice(-50);
    }

    saveBuffer(buffer);

    // 성공 출력
    console.log(JSON.stringify({
      success: true,
      captured: {
        type: conversation.type,
        length: userMessage.length
      }
    }));
    process.exit(0);

  } catch (error) {
    console.error('Prompt hook error:', error.message);
    process.exit(0); // 에러가 나도 Claude Code 진행을 막지 않음
  }
}

main();

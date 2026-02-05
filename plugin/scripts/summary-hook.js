#!/usr/bin/env node
/**
 * summary-hook.js
 * Stop Hook - 세션 종료 시 buffer를 요약하여 memories에 저장
 *
 * Phase 2 업그레이드: 선택적 AI 요약
 * - ANTHROPIC_API_KEY 있으면 → Claude Haiku로 고품질 요약
 * - 없으면 → 로컬 통계 요약 (기존 방식)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractKeywords, extractPathKeywords } = require('./utils');

// 설정
const DATA_DIR = path.join(os.homedir(), '.claude-simple-memory');
const BUFFER_FILE = path.join(DATA_DIR, 'buffer.json');
const MEMORIES_DIR = path.join(DATA_DIR, 'memories');

// AI 요약 설정
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUMMARY_MODEL = 'claude-3-5-haiku-20241022'; // 빠르고 저렴한 모델
const MAX_TOKENS = 300;

// 디렉토리 생성
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 버퍼 파일 로드
function loadBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      return JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { observations: [], session_start: null };
}

// 버퍼 파일 초기화
function clearBuffer() {
  const emptyBuffer = { observations: [], session_start: new Date().toISOString() };
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(emptyBuffer, null, 2), 'utf-8');
}

// 메모리 파일 로드
function loadMemories(project) {
  const memoryFile = path.join(MEMORIES_DIR, `${project}.json`);
  try {
    if (fs.existsSync(memoryFile)) {
      return JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
    }
  } catch (e) {}
  return { project, sessions: [], keywords: [] };
}

// 메모리 파일 저장
function saveMemories(project, memories) {
  ensureDir(MEMORIES_DIR);
  const memoryFile = path.join(MEMORIES_DIR, `${project}.json`);
  fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════
// AI 요약 (Phase 2)
// ═══════════════════════════════════════════════════════════════

async function generateAISummary(observations, conversations, project) {
  if (!ANTHROPIC_API_KEY) {
    return null; // API 키 없으면 null 반환 → 로컬 요약 사용
  }

  try {
    // 대화 내용 포함
    const conversationText = (conversations || [])
      .map(c => `- [${c.type}] "${c.message}"`)
      .join('\n');

    const observationText = (observations || [])
      .map(o => {
        let line = `- [${o.tool}] ${o.summary}`;
        if (o.context?.lastUserMessage) {
          line += `\n  사용자 요청: "${o.context.lastUserMessage}"`;
        }
        return line;
      })
      .join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: `당신은 개발 세션 요약 전문가입니다.

프로젝트: ${project}

이번 세션의 대화 내용:
${conversationText || '(대화 없음)'}

이번 세션에서 수행한 작업들:
${observationText || '(작업 없음)'}

위 대화와 작업을 분석하여 다음 형식으로 요약해주세요:
1. 핵심 주제 (1-2문장): 이번 세션에서 주로 무엇을 논의/작업했는지
2. 주요 질문과 답변: 사용자가 물어본 중요한 질문들
3. 변경/완료된 사항: 작업한 내용이 있다면

간결하고 명확하게 한국어로 답변하세요. 250자 이내로 요약하세요.`
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text.trim();

  } catch (error) {
    console.error('AI Summary error:', error.message);
    return null; // 에러 시 null → 로컬 요약 fallback
  }
}

// ═══════════════════════════════════════════════════════════════
// 로컬 요약 (Fallback)
// ═══════════════════════════════════════════════════════════════

function generateLocalSummary(observations, conversations) {
  const toolCounts = {};
  const files = new Set();
  const commands = [];
  const questions = [];
  let hasError = false;

  // 대화에서 질문 추출
  (conversations || []).forEach(c => {
    if (c.type === 'question') {
      questions.push(c.message.substring(0, 50));
    }
  });

  (observations || []).forEach(o => {
    // 도구별 카운트
    toolCounts[o.tool] = (toolCounts[o.tool] || 0) + 1;

    // 파일 수집
    if (o.details?.file) {
      files.add(path.basename(o.details.file));
    }

    // 주요 명령어 수집
    if (o.tool === 'Bash' && o.details?.command) {
      const cmd = o.details.command.split(' ')[0];
      if (['git', 'npm', 'yarn', 'pip', 'docker'].includes(cmd)) {
        commands.push(o.details.command.substring(0, 30));
      }
    }

    // 에러 여부
    if (o.details?.success === false) {
      hasError = true;
    }
  });

  // 요약 생성
  const toolSummary = Object.entries(toolCounts)
    .map(([tool, count]) => `${tool}(${count})`)
    .join(', ');

  const fileList = Array.from(files).slice(0, 5).join(', ');
  const moreFiles = files.size > 5 ? ` 외 ${files.size - 5}개` : '';

  let summary = `작업: ${toolSummary}`;

  if (fileList) {
    summary += ` | 파일: ${fileList}${moreFiles}`;
  }

  if (commands.length > 0) {
    summary += ` | 명령: ${commands.slice(0, 2).join(', ')}`;
  }

  if (hasError) {
    summary += ' | ⚠️ 일부 에러 발생';
  }

  // 질문이 있으면 추가
  if (questions.length > 0) {
    summary += ` | 💬 질문: "${questions[0]}"`;
    if (questions.length > 1) {
      summary += ` 외 ${questions.length - 1}개`;
    }
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════════
// 키워드 추출 (검색용)
// ═══════════════════════════════════════════════════════════════

function extractSessionKeywords(observations, conversations) {
  const keywords = new Set();

  // 대화에서 키워드 추출
  (conversations || []).forEach(c => {
    extractKeywords(c.message).forEach(k => keywords.add(k));
  });

  (observations || []).forEach(o => {
    // 요약에서 키워드
    extractKeywords(o.summary).forEach(k => keywords.add(k));

    // 파일 경로에서 키워드
    if (o.details?.file) {
      extractPathKeywords(o.details.file).forEach(k => keywords.add(k));
    }

    // 명령어에서 키워드
    if (o.details?.command) {
      extractKeywords(o.details.command).forEach(k => keywords.add(k));
    }
  });

  return Array.from(keywords).slice(0, 50); // 최대 50개
}

// ═══════════════════════════════════════════════════════════════
// 메인 함수
// ═══════════════════════════════════════════════════════════════

async function main() {
  try {
    // stdin에서 hook 데이터 읽기
    const input = fs.readFileSync(0, 'utf-8');
    const hookData = JSON.parse(input);

    const project = path.basename(hookData.cwd || process.cwd());
    const buffer = loadBuffer();

    // 관찰도 대화도 없으면 종료
    const hasObservations = buffer.observations && buffer.observations.length > 0;
    const hasConversations = buffer.conversations && buffer.conversations.length > 0;

    if (!hasObservations && !hasConversations) {
      console.log(JSON.stringify({ success: true, message: 'No observations or conversations to summarize' }));
      process.exit(0);
    }

    // 요약 생성 (AI 우선, 실패 시 로컬)
    let summary;
    let summaryType;

    const aiSummary = await generateAISummary(buffer.observations, buffer.conversations, project);
    if (aiSummary) {
      summary = aiSummary;
      summaryType = 'ai';
    } else {
      summary = generateLocalSummary(buffer.observations, buffer.conversations);
      summaryType = 'local';
    }

    // 키워드 추출 (검색용) - 대화 내용 포함
    const keywords = extractSessionKeywords(buffer.observations, buffer.conversations);

    // 메모리에 세션 저장
    const memories = loadMemories(project);
    memories.sessions.push({
      date: new Date().toISOString(),
      summary: summary,
      summary_type: summaryType,
      observation_count: buffer.observations?.length || 0,
      conversation_count: buffer.conversations?.length || 0,
      keywords: keywords,
      observations: (buffer.observations || []).slice(-20), // 최근 20개만 상세 저장
      conversations: (buffer.conversations || []).slice(-30) // 대화 최근 30개 저장
    });

    // 최대 50개 세션만 유지
    if (memories.sessions.length > 50) {
      memories.sessions = memories.sessions.slice(-50);
    }

    // 프로젝트 전체 키워드 업데이트
    const allKeywords = new Set(memories.keywords || []);
    keywords.forEach(k => allKeywords.add(k));
    memories.keywords = Array.from(allKeywords).slice(-200); // 최대 200개

    saveMemories(project, memories);

    // 버퍼 초기화
    clearBuffer();

    console.log(JSON.stringify({
      success: true,
      message: `Saved session with ${buffer.observations.length} observations`,
      summary_type: summaryType,
      summary: summary,
      keywords_count: keywords.length
    }));
    process.exit(0);

  } catch (error) {
    console.error('Summary hook error:', error.message);
    process.exit(0);
  }
}

main();

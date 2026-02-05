#!/usr/bin/env node
/**
 * observation-hook.js
 * PostToolUse Hook - 도구 사용 시 관찰 내용을 buffer에 저장
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 설정
const DATA_DIR = path.join(os.homedir(), '.claude-simple-memory');
const BUFFER_FILE = path.join(DATA_DIR, 'buffer.json');

// 데이터 디렉토리 생성
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// Transcript 파싱 - 대화 컨텍스트 추출 (claude-mem 스타일)
// ═══════════════════════════════════════════════════════════════

function extractConversationContext(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    // 최근 메시지만 파싱 (성능 최적화 - 마지막 50줄만)
    const recentLines = lines.slice(-50);
    const messages = [];

    for (const line of recentLines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'message' || msg.role) {
          messages.push(msg);
        }
      } catch (e) {
        // 파싱 실패한 줄은 무시
      }
    }

    // 마지막 user 메시지 찾기
    let lastUserMessage = null;
    let lastAssistantMessage = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const role = msg.role || msg.type;

      if (!lastUserMessage && role === 'user') {
        // user 메시지 내용 추출
        lastUserMessage = extractMessageContent(msg);
      }

      if (!lastAssistantMessage && role === 'assistant') {
        // assistant 메시지 내용 추출
        lastAssistantMessage = extractMessageContent(msg);
      }

      // 둘 다 찾으면 종료
      if (lastUserMessage && lastAssistantMessage) break;
    }

    return {
      lastUserMessage: lastUserMessage ? truncate(lastUserMessage, 200) : null,
      lastAssistantMessage: lastAssistantMessage ? truncate(lastAssistantMessage, 200) : null
    };

  } catch (error) {
    // 파싱 실패 시 null 반환
    return null;
  }
}

// 메시지 객체에서 텍스트 내용 추출
function extractMessageContent(msg) {
  // 직접 텍스트인 경우
  if (typeof msg.content === 'string') {
    return msg.content;
  }

  // content 배열인 경우 (Claude API 형식)
  if (Array.isArray(msg.content)) {
    const textParts = msg.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join(' ');
    return textParts || null;
  }

  // message 필드가 있는 경우
  if (msg.message) {
    return extractMessageContent(msg.message);
  }

  return null;
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
  return { observations: [], conversations: [], session_start: new Date().toISOString() };
}

// 버퍼 파일 저장
function saveBuffer(buffer) {
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(buffer, null, 2), 'utf-8');
}

// 문자열을 최대 길이로 자르기
function truncate(str, maxLen = 100) {
  if (!str) return '';
  str = String(str).trim();
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// 파일 경로에서 파일명만 추출 (짧게)
function shortPath(filePath) {
  if (!filePath) return 'unknown';
  // 마지막 2단계만 유지: src/components/Button.js → components/Button.js
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

// 에러 응답인지 확인
function isError(response) {
  if (!response) return false;
  const lower = String(response).toLowerCase();
  return lower.includes('error') || lower.includes('failed') || lower.includes('not found');
}

// 관찰 포맷 함수
function formatObservation(toolData) {
  const { tool_name, tool_input, tool_response } = toolData;
  const hasError = isError(tool_response);

  // ═══════════════════════════════════════════════════════════
  // Edit 도구: 파일 수정
  // ═══════════════════════════════════════════════════════════
  if (tool_name === 'Edit') {
    const file = shortPath(tool_input?.file_path);
    const newCode = truncate(tool_input?.new_string, 100);

    return {
      summary: hasError
        ? `❌ Failed to edit ${file}`
        : `✏️ Edited ${file}: ${newCode}`,
      details: {
        file: tool_input?.file_path,
        success: !hasError,
        preview: newCode
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Write 도구: 파일 생성
  // ═══════════════════════════════════════════════════════════
  if (tool_name === 'Write') {
    const file = shortPath(tool_input?.file_path);
    const content = truncate(tool_input?.content, 100);

    return {
      summary: hasError
        ? `❌ Failed to create ${file}`
        : `📝 Created ${file}: ${content}`,
      details: {
        file: tool_input?.file_path,
        success: !hasError,
        preview: content
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Bash 도구: 명령어 실행
  // ═══════════════════════════════════════════════════════════
  if (tool_name === 'Bash') {
    const command = tool_input?.command || '';
    const firstWord = command.split(/\s+/)[0] || 'unknown';

    // 중요한 명령어 카테고리 분류
    const cmdCategories = {
      git: '🔀',      // 버전 관리
      npm: '📦',      // Node.js 패키지
      yarn: '📦',
      pnpm: '📦',
      pip: '🐍',      // Python 패키지
      python: '🐍',
      docker: '🐳',   // 컨테이너
      kubectl: '☸️',  // Kubernetes
      make: '🔨',     // 빌드
      cargo: '🦀',    // Rust
      go: '🐹',       // Go
    };

    const emoji = cmdCategories[firstWord] || '💻';
    const shortCmd = truncate(command, 80);
    const output = truncate(tool_response, 50);

    // git 명령어는 서브커맨드도 포함 (git commit, git push 등)
    let cmdLabel = firstWord;
    if (firstWord === 'git' && command.split(/\s+/)[1]) {
      cmdLabel = `git ${command.split(/\s+/)[1]}`;
    }

    return {
      summary: hasError
        ? `❌ ${cmdLabel} failed: ${shortCmd}`
        : `${emoji} Ran ${cmdLabel}: ${shortCmd}`,
      details: {
        command: command,
        success: !hasError,
        output: output
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Task 도구: 서브에이전트 실행
  // ═══════════════════════════════════════════════════════════
  if (tool_name === 'Task') {
    const agentType = tool_input?.subagent_type || 'unknown';
    const description = tool_input?.description || '';
    const prompt = truncate(tool_input?.prompt, 80);

    // 에이전트 타입별 이모지
    const agentEmojis = {
      'Explore': '🔍',
      'Plan': '📋',
      'Bash': '💻',
      'general-purpose': '🤖',
    };

    const emoji = agentEmojis[agentType] || '🤖';

    return {
      summary: hasError
        ? `❌ Agent ${agentType} failed: ${description}`
        : `${emoji} Agent ${agentType}: ${description || prompt}`,
      details: {
        agent_type: agentType,
        description: description,
        success: !hasError
      }
    };
  }

  return null; // 알 수 없는 도구는 무시
}

// 메인 함수
async function main() {
  try {
    // stdin에서 hook 데이터 읽기
    const input = fs.readFileSync(0, 'utf-8'); // stdin
    const hookData = JSON.parse(input);

    ensureDataDir();

    const observation = formatObservation({
      tool_name: hookData.tool_name,
      tool_input: hookData.tool_input,
      tool_response: hookData.tool_response,
      cwd: hookData.cwd
    });

    if (observation) {
      const buffer = loadBuffer();

      // 대화 컨텍스트 추출 (왜 이 작업을 했는지)
      const conversationContext = extractConversationContext(hookData.transcript_path);

      buffer.observations.push({
        ...observation,
        tool: hookData.tool_name,
        timestamp: new Date().toISOString(),
        project: path.basename(hookData.cwd || process.cwd()),
        // 대화 컨텍스트 추가 (claude-mem 스타일)
        context: conversationContext
      });

      // 최대 100개 관찰만 유지 (메모리 관리)
      if (buffer.observations.length > 100) {
        buffer.observations = buffer.observations.slice(-100);
      }

      saveBuffer(buffer);
    }

    // 성공 출력 (Claude Code가 확인)
    console.log(JSON.stringify({ success: true }));
    process.exit(0);

  } catch (error) {
    console.error('Observation hook error:', error.message);
    process.exit(0); // 에러가 나도 Claude Code 진행을 막지 않음
  }
}

main();

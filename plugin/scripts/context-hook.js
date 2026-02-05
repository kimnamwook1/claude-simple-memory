#!/usr/bin/env node
/**
 * context-hook.js
 * SessionStart Hook - 세션 시작 시 관련 memories를 로드하여 컨텍스트로 주입
 *
 * Phase 1 업그레이드: TF-IDF 기반 관련성 필터링
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { calculateRelevanceScores, extractPathKeywords } = require('./utils');

// 설정
const DATA_DIR = path.join(os.homedir(), '.claude-simple-memory');
const MEMORIES_DIR = path.join(DATA_DIR, 'memories');
const MAX_SESSIONS_TO_SHOW = 5;        // 최대 표시 세션 수
const MAX_OBSERVATIONS_PER_SESSION = 8; // 세션당 최대 관찰 수
const MIN_RELEVANCE_SCORE = 0.1;       // 최소 관련성 점수

// 메모리 파일 로드
function loadMemories(project) {
  const memoryFile = path.join(MEMORIES_DIR, `${project}.json`);
  try {
    if (fs.existsSync(memoryFile)) {
      return JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
    }
  } catch (e) {
    // 파일이 없거나 손상되면 null 반환
  }
  return null;
}

// 모든 프로젝트의 메모리 로드
function loadAllMemories() {
  const allMemories = [];
  try {
    if (!fs.existsSync(MEMORIES_DIR)) return allMemories;

    const files = fs.readdirSync(MEMORIES_DIR);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(MEMORIES_DIR, file), 'utf-8');
          const memories = JSON.parse(content);
          if (memories.sessions) {
            memories.sessions.forEach(session => {
              allMemories.push({
                ...session,
                project: memories.project
              });
            });
          }
        } catch (e) {
          // 개별 파일 에러 무시
        }
      }
    });
  } catch (e) {
    // 디렉토리 읽기 에러
  }
  return allMemories;
}

// 날짜 포맷팅
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;

  return date.toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric'
  });
}

// 관련성 점수를 시각화
function formatRelevanceBar(score) {
  const filled = Math.round(score * 5);
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

// 메모리를 컨텍스트 문자열로 변환
function formatContext(rankedSessions, currentProject) {
  if (!rankedSessions || rankedSessions.length === 0) {
    return null;
  }

  let context = `# 📚 관련 세션 기록\n\n`;
  context += `> 현재 프로젝트: **${currentProject}** | TF-IDF 기반 관련성 분석\n\n`;

  rankedSessions.forEach((item, index) => {
    const { session, score } = item;
    const dateLabel = formatDate(session.date);
    const relevanceBar = formatRelevanceBar(score);
    const projectLabel = session.project !== currentProject ? ` (${session.project})` : '';

    context += `## ${index + 1}. ${dateLabel}${projectLabel}\n`;
    context += `**관련도:** ${relevanceBar} (${(score * 100).toFixed(0)}%)\n`;
    context += `**요약:** ${session.summary}\n`;

    // 대화 내용 표시 (핵심!)
    if (session.conversations && session.conversations.length > 0) {
      const recentConvs = session.conversations.slice(-5);
      context += `**💬 대화 내용:**\n`;
      recentConvs.forEach(conv => {
        const typeEmoji = conv.type === 'question' ? '❓' : conv.type === 'request' ? '📝' : '💬';
        context += `- ${typeEmoji} "${conv.message}"\n`;
      });
    }

    // 상세 관찰 (있으면)
    if (session.observations && session.observations.length > 0) {
      const recentObs = session.observations.slice(-MAX_OBSERVATIONS_PER_SESSION);
      context += `**🔧 작업 내역:**\n`;
      recentObs.forEach(obs => {
        context += `- ${obs.summary}\n`;
        if (obs.context?.lastUserMessage) {
          context += `  💬 _"${obs.context.lastUserMessage}"_\n`;
        }
      });
    }

    context += '\n';
  });

  context += `---\n`;
  context += `_claude-simple-memory v2.1 | TF-IDF 관련성 필터링 + 대화 컨텍스트 저장_\n`;

  return context;
}

// 메인 함수
async function main() {
  try {
    // stdin에서 hook 데이터 읽기
    let hookData = {};
    try {
      const input = fs.readFileSync(0, 'utf-8');
      if (input.trim()) {
        hookData = JSON.parse(input);
      }
    } catch (e) {
      // stdin이 비어있을 수 있음
    }

    // 프로젝트 이름 결정
    const cwd = hookData.cwd || process.cwd();
    const currentProject = path.basename(cwd);

    // 현재 프로젝트 메모리 로드
    const projectMemories = loadMemories(currentProject);

    // 모든 프로젝트 메모리도 로드 (교차 프로젝트 관련성 검색)
    const allSessions = loadAllMemories();

    if (allSessions.length === 0) {
      // Claude Code SessionStart hook 형식: hookSpecificOutput.additionalContext
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ''
        }
      }));
      process.exit(0);
    }

    // 현재 컨텍스트 구성
    const currentContext = {
      cwd: cwd,
      project: currentProject,
      recentFiles: [] // 추후 확장 가능
    };

    // TF-IDF 기반 관련성 점수 계산
    const rankedSessions = calculateRelevanceScores(currentContext, allSessions);

    // 관련성 높은 세션만 필터링
    const relevantSessions = rankedSessions
      .filter(item => item.score >= MIN_RELEVANCE_SCORE)
      .slice(0, MAX_SESSIONS_TO_SHOW);

    // 관련 세션이 없으면 최근 세션이라도 표시
    if (relevantSessions.length === 0 && rankedSessions.length > 0) {
      relevantSessions.push(...rankedSessions.slice(0, 3));
    }

    if (relevantSessions.length === 0) {
      // Claude Code SessionStart hook 형식: hookSpecificOutput.additionalContext
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ''
        }
      }));
      process.exit(0);
    }

    // 컨텍스트 생성
    const context = formatContext(relevantSessions, currentProject);

    // Claude Code SessionStart hook 형식: hookSpecificOutput.additionalContext
    // 이 형식이 Claude에게 컨텍스트로 주입됨!
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context || ''
      }
    }));

    process.exit(0);

  } catch (error) {
    console.error('Context hook error:', error.message);
    process.exit(0);
  }
}

main();

#!/usr/bin/env node
/**
 * memory-commands.js
 * /memory 명령어 처리 스크립트
 *
 * 사용법:
 *   node memory-commands.js search <keyword>
 *   node memory-commands.js timeline [count]
 *   node memory-commands.js show
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 설정
const DATA_DIR = path.join(os.homedir(), '.claude-simple-memory');
const BUFFER_FILE = path.join(DATA_DIR, 'buffer.json');
const MEMORIES_DIR = path.join(DATA_DIR, 'memories');

// ═══════════════════════════════════════════════════════════════
// 유틸리티 함수
// ═══════════════════════════════════════════════════════════════

function loadBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      return JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { observations: [], session_start: null };
}

function loadAllMemories() {
  const allSessions = [];
  try {
    if (!fs.existsSync(MEMORIES_DIR)) return allSessions;

    const files = fs.readdirSync(MEMORIES_DIR);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(MEMORIES_DIR, file), 'utf-8');
          const memories = JSON.parse(content);
          if (memories.sessions) {
            memories.sessions.forEach(session => {
              allSessions.push({
                ...session,
                project: memories.project
              });
            });
          }
        } catch (e) {}
      }
    });
  } catch (e) {}

  // 날짜순 정렬 (최신 먼저)
  return allSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}

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

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ═══════════════════════════════════════════════════════════════
// search 명령어 - 키워드로 메모리 검색
// ═══════════════════════════════════════════════════════════════

function commandSearch(keyword) {
  if (!keyword) {
    console.log('❌ 검색어를 입력해주세요: /memory search <키워드>');
    return;
  }

  const sessions = loadAllMemories();
  const lowerKeyword = keyword.toLowerCase();

  // 키워드가 포함된 세션 찾기
  const matches = sessions.filter(session => {
    // 요약에서 검색
    if (session.summary?.toLowerCase().includes(lowerKeyword)) return true;

    // 키워드 목록에서 검색
    if (session.keywords?.some(k => k.toLowerCase().includes(lowerKeyword))) return true;

    // 관찰 내용에서 검색
    if (session.observations?.some(o =>
      o.summary?.toLowerCase().includes(lowerKeyword) ||
      o.details?.file?.toLowerCase().includes(lowerKeyword) ||
      o.details?.command?.toLowerCase().includes(lowerKeyword) ||
      o.context?.lastUserMessage?.toLowerCase().includes(lowerKeyword)
    )) return true;

    return false;
  });

  if (matches.length === 0) {
    console.log(`\n🔍 "${keyword}" 검색 결과: 없음\n`);
    return;
  }

  console.log(`\n# 🔍 "${keyword}" 검색 결과 (${matches.length}건)\n`);

  matches.slice(0, 10).forEach((session, index) => {
    console.log(`## ${index + 1}. ${formatDate(session.date)} (${session.project})`);
    console.log(`**요약:** ${session.summary}`);

    // 매칭된 관찰 표시
    const matchingObs = session.observations?.filter(o =>
      o.summary?.toLowerCase().includes(lowerKeyword) ||
      o.context?.lastUserMessage?.toLowerCase().includes(lowerKeyword)
    ).slice(0, 3);

    if (matchingObs?.length > 0) {
      console.log('**매칭된 작업:**');
      matchingObs.forEach(o => {
        console.log(`- ${o.summary}`);
        if (o.context?.lastUserMessage) {
          console.log(`  💬 _"${o.context.lastUserMessage}"_`);
        }
      });
    }
    console.log('');
  });

  if (matches.length > 10) {
    console.log(`_... 외 ${matches.length - 10}건 더 있음_\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// timeline 명령어 - 최근 세션 목록
// ═══════════════════════════════════════════════════════════════

function commandTimeline(count = 10) {
  const sessions = loadAllMemories();

  if (sessions.length === 0) {
    console.log('\n📅 저장된 세션이 없습니다.\n');
    return;
  }

  const limit = Math.min(parseInt(count) || 10, 20);

  console.log(`\n# 📅 세션 타임라인 (최근 ${limit}개)\n`);

  let currentDate = '';
  sessions.slice(0, limit).forEach((session, index) => {
    const dateLabel = formatDate(session.date);
    const timeLabel = formatTime(session.date);

    // 날짜가 바뀌면 구분선
    if (dateLabel !== currentDate) {
      if (currentDate) console.log('');
      console.log(`### ${dateLabel}`);
      currentDate = dateLabel;
    }

    const obsCount = session.observation_count || session.observations?.length || 0;
    const summaryType = session.summary_type === 'ai' ? '🤖' : '📝';

    console.log(`- **${timeLabel}** [${session.project}] ${summaryType} ${session.summary.substring(0, 60)}${session.summary.length > 60 ? '...' : ''}`);
    console.log(`  _${obsCount}개 작업_`);
  });

  console.log(`\n---\n_전체 ${sessions.length}개 세션 저장됨_\n`);
}

// ═══════════════════════════════════════════════════════════════
// show 명령어 - 현재 세션 버퍼 표시
// ═══════════════════════════════════════════════════════════════

function commandShow() {
  const buffer = loadBuffer();

  if (!buffer.observations || buffer.observations.length === 0) {
    console.log('\n📋 현재 세션에 저장된 관찰이 없습니다.\n');
    return;
  }

  console.log(`\n# 📋 현재 세션 버퍼\n`);
  console.log(`> 세션 시작: ${buffer.session_start || '알 수 없음'}`);
  console.log(`> 관찰 수: ${buffer.observations.length}개\n`);

  buffer.observations.forEach((obs, index) => {
    const time = new Date(obs.timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    console.log(`### ${index + 1}. [${time}] ${obs.tool}`);
    console.log(`${obs.summary}`);

    if (obs.context?.lastUserMessage) {
      console.log(`💬 _"${obs.context.lastUserMessage}"_`);
    }

    console.log('');
  });

  console.log('---\n_세션 종료 시 자동으로 memories에 저장됩니다_\n');
}

// ═══════════════════════════════════════════════════════════════
// stats 명령어 - 메모리 통계
// ═══════════════════════════════════════════════════════════════

function commandStats() {
  const sessions = loadAllMemories();
  const buffer = loadBuffer();

  // 프로젝트별 집계
  const projectStats = {};
  sessions.forEach(s => {
    if (!projectStats[s.project]) {
      projectStats[s.project] = { count: 0, observations: 0 };
    }
    projectStats[s.project].count++;
    projectStats[s.project].observations += s.observation_count || s.observations?.length || 0;
  });

  console.log('\n# 📊 메모리 통계\n');
  console.log(`| 항목 | 값 |`);
  console.log(`|------|-----|`);
  console.log(`| 전체 세션 | ${sessions.length}개 |`);
  console.log(`| 프로젝트 수 | ${Object.keys(projectStats).length}개 |`);
  console.log(`| 현재 버퍼 | ${buffer.observations?.length || 0}개 관찰 |`);

  const totalObs = sessions.reduce((sum, s) => sum + (s.observation_count || s.observations?.length || 0), 0);
  console.log(`| 전체 관찰 | ${totalObs}개 |`);

  if (Object.keys(projectStats).length > 0) {
    console.log('\n### 프로젝트별 통계\n');
    console.log('| 프로젝트 | 세션 수 | 관찰 수 |');
    console.log('|----------|---------|---------|');
    Object.entries(projectStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .forEach(([project, stats]) => {
        console.log(`| ${project} | ${stats.count} | ${stats.observations} |`);
      });
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════════════════

const [,, command, ...args] = process.argv;

switch (command) {
  case 'search':
    commandSearch(args.join(' '));
    break;
  case 'timeline':
    commandTimeline(args[0]);
    break;
  case 'show':
    commandShow();
    break;
  case 'stats':
    commandStats();
    break;
  default:
    console.log(`
# 📚 Memory 명령어

사용 가능한 명령어:

- **/memory search <키워드>** - 메모리에서 키워드 검색
- **/memory timeline [개수]** - 최근 세션 타임라인 (기본 10개)
- **/memory show** - 현재 세션 버퍼 내용
- **/memory stats** - 메모리 통계

예시:
  /memory search jwt
  /memory timeline 20
  /memory show
`);
}

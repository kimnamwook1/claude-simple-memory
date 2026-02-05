/**
 * utils.js
 * 공통 유틸리티 함수들 - 키워드 추출, TF-IDF, 관련성 점수 계산
 */

// ═══════════════════════════════════════════════════════════════
// 텍스트 전처리
// ═══════════════════════════════════════════════════════════════

// 불용어 (stopwords) - 의미 없는 단어들
const STOPWORDS = new Set([
  // 영어
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
  'this', 'that', 'these', 'those', 'it', 'its',
  // 한국어
  '이', '그', '저', '것', '수', '등', '들', '및', '에', '의', '를', '을',
  '은', '는', '이', '가', '와', '과', '로', '으로', '에서', '까지', '부터',
  // 코드 관련
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from',
  'true', 'false', 'null', 'undefined', 'new', 'class', 'extends',
  'async', 'await', 'try', 'catch', 'if', 'else', 'for', 'while',
]);

// 텍스트에서 키워드 추출
function extractKeywords(text) {
  if (!text) return [];

  // 소문자 변환 및 특수문자 제거
  const normalized = String(text)
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 단어 분리
  const words = normalized.split(' ');

  // 불용어 제거 및 필터링
  const keywords = words.filter(word => {
    if (word.length < 2) return false;           // 너무 짧은 단어
    if (STOPWORDS.has(word)) return false;       // 불용어
    if (/^\d+$/.test(word)) return false;        // 숫자만
    return true;
  });

  return keywords;
}

// 파일 경로에서 의미 있는 키워드 추출
function extractPathKeywords(filePath) {
  if (!filePath) return [];

  // 경로를 분리하고 확장자 제거
  const parts = filePath
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/\.[^.]+$/, '')) // 확장자 제거
    .filter(part => part && part.length > 1);

  // camelCase, snake_case, kebab-case 분리
  const keywords = [];
  parts.forEach(part => {
    // camelCase 분리: handleUserLogin → handle, user, login
    const camelSplit = part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    // snake_case, kebab-case 분리
    const words = camelSplit.split(/[-_\s]+/);
    keywords.push(...words.filter(w => w.length > 1 && !STOPWORDS.has(w)));
  });

  return keywords;
}

// ═══════════════════════════════════════════════════════════════
// TF-IDF 계산
// ═══════════════════════════════════════════════════════════════

// 단어 빈도 계산 (Term Frequency)
function calculateTF(keywords) {
  const tf = {};
  keywords.forEach(word => {
    tf[word] = (tf[word] || 0) + 1;
  });

  // 정규화
  const maxFreq = Math.max(...Object.values(tf), 1);
  Object.keys(tf).forEach(word => {
    tf[word] = tf[word] / maxFreq;
  });

  return tf;
}

// 문서 빈도 계산 (Document Frequency)
function calculateDF(documents) {
  const df = {};
  documents.forEach(doc => {
    const uniqueWords = new Set(doc);
    uniqueWords.forEach(word => {
      df[word] = (df[word] || 0) + 1;
    });
  });
  return df;
}

// TF-IDF 점수 계산
function calculateTFIDF(keywords, df, totalDocs) {
  const tf = calculateTF(keywords);
  const tfidf = {};

  Object.keys(tf).forEach(word => {
    const idf = Math.log((totalDocs + 1) / ((df[word] || 0) + 1)) + 1;
    tfidf[word] = tf[word] * idf;
  });

  return tfidf;
}

// 두 TF-IDF 벡터 간의 코사인 유사도
function cosineSimilarity(vec1, vec2) {
  const allWords = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  allWords.forEach(word => {
    const v1 = vec1[word] || 0;
    const v2 = vec2[word] || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  });

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ═══════════════════════════════════════════════════════════════
// 관련성 점수 계산
// ═══════════════════════════════════════════════════════════════

// 세션의 키워드 추출
function extractSessionKeywords(session) {
  const keywords = [];

  // 요약에서 추출
  if (session.summary) {
    keywords.push(...extractKeywords(session.summary));
  }

  // ★ 대화 내용에서 키워드 추출 (핵심!)
  if (session.conversations && session.conversations.length > 0) {
    session.conversations.forEach(conv => {
      if (conv.message) {
        keywords.push(...extractKeywords(conv.message));
      }
    });
  }

  // 관찰들에서 추출
  if (session.observations) {
    session.observations.forEach(obs => {
      keywords.push(...extractKeywords(obs.summary));
      if (obs.details?.file) {
        keywords.push(...extractPathKeywords(obs.details.file));
      }
      if (obs.details?.command) {
        keywords.push(...extractKeywords(obs.details.command));
      }
      // 관찰 내 lastUserMessage도 추출
      if (obs.context?.lastUserMessage) {
        keywords.push(...extractKeywords(obs.context.lastUserMessage));
      }
    });
  }

  return keywords;
}

// 현재 컨텍스트와 세션들의 관련성 점수 계산
function calculateRelevanceScores(currentContext, sessions) {
  if (!sessions || sessions.length === 0) return [];

  // 현재 컨텍스트 키워드 추출
  const contextKeywords = [];
  if (currentContext.cwd) {
    contextKeywords.push(...extractPathKeywords(currentContext.cwd));
  }
  if (currentContext.recentFiles) {
    currentContext.recentFiles.forEach(file => {
      contextKeywords.push(...extractPathKeywords(file));
    });
  }

  // 모든 세션의 키워드 추출
  const sessionKeywordsList = sessions.map(s => extractSessionKeywords(s));

  // DF 계산
  const df = calculateDF([contextKeywords, ...sessionKeywordsList]);
  const totalDocs = sessions.length + 1;

  // 현재 컨텍스트의 TF-IDF
  const contextTFIDF = calculateTFIDF(contextKeywords, df, totalDocs);

  // 각 세션의 관련성 점수 계산
  const scores = sessions.map((session, index) => {
    const sessionTFIDF = calculateTFIDF(sessionKeywordsList[index], df, totalDocs);
    const similarity = cosineSimilarity(contextTFIDF, sessionTFIDF);

    // 시간 가중치 (최근일수록 높은 점수) - 더 급격한 감쇠
    const daysSinceSession = (Date.now() - new Date(session.date).getTime()) / (1000 * 60 * 60 * 24);
    const hoursSinceSession = (Date.now() - new Date(session.date).getTime()) / (1000 * 60 * 60);

    // ★ 24시간 이내 세션은 시간 가중치 크게 부여
    let timeWeight;
    if (hoursSinceSession < 24) {
      timeWeight = 1.0 - (hoursSinceSession / 48); // 24시간 이내: 1.0 → 0.5
    } else {
      timeWeight = Math.exp(-daysSinceSession / 14); // 14일 반감기 (더 급격)
    }

    // ★ 대화(conversations)가 있는 세션에 보너스
    const hasConversations = session.conversations && session.conversations.length > 0;
    const conversationBonus = hasConversations ? 0.15 : 0;

    // 최종 점수: 유사도 40% + 시간 45% + 대화보너스 15%
    const finalScore = similarity * 0.4 + timeWeight * 0.45 + conversationBonus;

    return {
      session,
      similarity,
      timeWeight,
      conversationBonus,
      score: Math.min(finalScore, 1.0) // 최대 1.0
    };
  });

  // 점수 순으로 정렬
  return scores.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════

module.exports = {
  extractKeywords,
  extractPathKeywords,
  extractSessionKeywords,
  calculateTF,
  calculateDF,
  calculateTFIDF,
  cosineSimilarity,
  calculateRelevanceScores,
  STOPWORDS
};

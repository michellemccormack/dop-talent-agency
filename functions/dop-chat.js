// functions/dop-chat.js
// GPT-powered intent router for Phase 1 (no embeddings yet)

const MAX_INPUT_LENGTH = 500;
const OPENAI_TIMEOUT_MS = 10000;
const MIN_CONFIDENCE_THRESHOLD = 0.6;

// Configuration - easily maintainable
const INTENT_OPTIONS = [
  { id: 'fun',   label: 'What do you like to do for fun?', clip: 'assets/p_fun.mp4', keywords: ['fun', 'hobby', 'hobbies', 'enjoy', 'pastime'] },
  { id: 'from',  label: 'Where are you from?',              clip: 'assets/p_from.mp4', keywords: ['from', 'where', 'origin', 'hometown', 'grew up'] },
  { id: 'relax', label: 'What's your favorite way to relax?', clip: 'assets/p_relax.mp4', keywords: ['relax', 'unwind', 'chill', 'de-stress', 'calm down'] },
];

export const handler = async (event) => {
  // Method validation
  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // Parse and validate input
    const { text } = JSON.parse(event.body || '{}');
    const userInput = (text || '').trim();
    
    if (!userInput) {
      return json({ error: 'Missing text field' }, 400);
    }
    
    if (userInput.length > MAX_INPUT_LENGTH) {
      return json({ error: `Input too long. Maximum ${MAX_INPUT_LENGTH} characters allowed` }, 400);
    }

    // Fast path: keyword matching
    const keywordMatch = checkKeywordMatch(userInput);
    if (keywordMatch) {
      return json({ 
        matchedClip: keywordMatch.clip,
        matchedIntent: keywordMatch.id,
        method: 'keyword'
      });
    }

    // GPT classification path
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not configured, using fallback');
      return json({ 
        fallbackResponse: generateFallbackMessage(),
        method: 'fallback-no-key'
      });
    }

    const gptResult = await classifyWithGPT(userInput, OPENAI_API_KEY);
    
    if (gptResult.error) {
      console.error('GPT classification failed:', gptResult.error);
      return json({ 
        fallbackResponse: generateFallbackMessage(),
        method: 'fallback-gpt-error'
      });
    }

    const { id: choice, confidence } = gptResult;

    // High confidence match
    if (choice && choice !== 'none' && confidence >= MIN_CONFIDENCE_THRESHOLD) {
      const matchedOption = INTENT_OPTIONS.find(o => o.id === choice);
      if (matchedOption) {
        return json({ 
          matchedClip: matchedOption.clip,
          matchedIntent: matchedOption.id,
          confidence,
          method: 'gpt'
        });
      }
    }

    // Low confidence - return helpful fallback
    return json({ 
      fallbackResponse: generateFallbackMessage(),
      confidence,
      method: 'fallback-low-confidence'
    });

  } catch (error) {
    console.error('Handler error:', error);
    return json({ 
      error: 'Unable to process request. Please try again.',
      fallbackResponse: generateFallbackMessage()
    }, 500);
  }
};

/**
 * Fast keyword-based matching
 */
function checkKeywordMatch(userInput) {
  const normalized = userInput.toLowerCase();
  
  // Special case: "where are you from" pattern
  if ((normalized.includes('where') && normalized.includes('from')) || 
      (normalized.includes('where') && normalized.includes('you') && normalized.includes('from'))) {
    return INTENT_OPTIONS.find(o => o.id === 'from');
  }
  
  // Check each intent's keywords
  for (const option of INTENT_OPTIONS) {
    const keywordMatches = option.keywords.filter(kw => normalized.includes(kw)).length;
    
    // Match if 2+ keywords found, or specific single keywords
    if (keywordMatches >= 2) {
      return option;
    }
    
    // Special handling for strong single keywords
    if (option.id === 'relax' && normalized.includes('relax')) {
      return option;
    }
    
    if (option.id === 'fun' && (
      (normalized.includes('what') && normalized.includes('fun')) || 
      normalized.includes('for fun')
    )) {
      return option;
    }
  }
  
  return null;
}

/**
 * Classify user input using GPT with timeout
 */
async function classifyWithGPT(userInput, apiKey) {
  const systemPrompt = [
    "You are an intent classifier. Analyze the user's question and match it to the best intent.",
    `Available intents: ${INTENT_OPTIONS.map(o => `${o.id} (${o.label})`).join(' | ')}`,
    "Respond ONLY with valid JSON: {\"id\": \"<intent_id>\", \"confidence\": <0.0-1.0>, \"reason\": \"<brief explanation>\"}",
    `If no good match exists (confidence < ${MIN_CONFIDENCE_THRESHOLD}), return {\"id\":\"none\",\"confidence\":<score>,\"reason\":\"<why>\"}`
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Classify this question:\n"${userInput}"` }
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error: ${response.status} ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content);
    
    // Validate response structure
    if (!parsed.id || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid response format from GPT');
    }

    return {
      id: parsed.id.toLowerCase(),
      confidence: parsed.confidence,
      reason: parsed.reason || ''
    };

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      return { error: 'OpenAI request timeout' };
    }
    
    return { error: error.message };
  }
}

/**
 * Generate helpful fallback message
 */
function generateFallbackMessage() {
  const examples = INTENT_OPTIONS.map(o => o.label).join(', or ');
  return `I'd love to show you a clip! Try asking: ${examples}`;
}

/**
 * Create standardized JSON response
 */
function json(data, statusCode = 200) {
  return {
    statusCode,
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(data)
  };
}
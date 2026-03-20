// Netlify serverless function to proxy Anthropic API requests
// The API key is stored as a Netlify environment variable: ANTHROPIC_API_KEY
// This function handles streaming responses from Anthropic API

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Get API key from environment variable
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Please set it in Netlify environment variables.' }),
    };
  }

  try {
    // Parse the request body
    const requestBody = JSON.parse(event.body);

    // Forward the request to Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(requestBody),
    });

    // Handle errors
    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: errorText || JSON.stringify({ error: `Anthropic API error: ${response.status}` }),
      };
    }

    // For streaming responses, read the stream and return it
    // Note: Netlify Functions have limitations with streaming
    // Edge Functions (anthropic-proxy.ts) are preferred for streaming support
    if (requestBody.stream === true && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamData = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamData += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: streamData,
      };
    } else {
      // For non-streaming, return the JSON response
      const data = await response.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }
  } catch (error) {
    console.error('Error proxying to Anthropic:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

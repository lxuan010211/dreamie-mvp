const dashScopeAsrEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

type FetchLike = typeof fetch;

type DashScopeAsrOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
};

type TranscriptionInput = {
  dataUrl: string;
  format: string;
};

export function createDashScopeAsr({ apiKey, model, fetchImpl = fetch }: DashScopeAsrOptions) {
  return {
    async transcribe({ dataUrl, format }: TranscriptionInput) {
      if (!dataUrl.startsWith('data:audio/')) throw new Error('请上传有效的音频数据。');

      const response = await fetchImpl(dashScopeAsrEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-SSE': 'disable',
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [{
              role: 'user',
              content: [{ type: 'input_audio', input_audio: { data: dataUrl } }],
            }],
          },
          parameters: { format, language_hints: ['zh'] },
        }),
      });
      const payload = await response.json() as { output?: { text?: unknown }; message?: unknown };
      if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : '语音识别服务暂时不可用。');
      const text = typeof payload.output?.text === 'string' ? payload.output.text.trim() : '';
      if (!text) throw new Error('没有识别到清晰的语音，请再试一次。');
      return text;
    },
  };
}

import db from './mock-sdk-db.js';

export class BotApiError extends Error {
  constructor(code, description, method, parameters = {}) {
    super(description);
    this.name = 'BotApiError';
    this.code = code;
    this.description = description;
    this.method = method;
    this.parameters = parameters;
  }
}

export class EndpointError extends Error {
  constructor(description, parameters = {}) {
    if (typeof description !== 'string') {
      throw new TypeError('EndpointError description must be a string');
    }
    super(description);
    this.name = 'EndpointError';
    this.description = description;
    this.parameters = parameters;
  }
}

export class InputFile {
  constructor(bytes, filename, options = {}) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.filename = filename;
    this.type = options.type || 'application/octet-stream';
  }
}

export const mockState = {
  apiCalls: [],
  fileStore: new Map(), // file_id -> Uint8Array
  fetchHandler: null,
  apiInterceptor: null,
  nextMessageId: 100,
};

export function resetMockSdk() {
  mockState.apiCalls = [];
  mockState.fileStore.clear();
  mockState.fetchHandler = null;
  mockState.apiInterceptor = null;
  mockState.nextMessageId = 100;
}

export const api = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return async (params = {}) => {
        mockState.apiCalls.push({ method: prop, params });

        if (typeof mockState.apiInterceptor === 'function') {
          const custom = await mockState.apiInterceptor(prop, params);
          if (custom !== undefined) return custom;
        }

        if (prop === 'getFileContent') {
          const fid = typeof params === 'string' ? params : params.file_id;
          if (!mockState.fileStore.has(fid)) {
            throw new BotApiError(400, 'Bad file_id', 'getFileContent');
          }
          return mockState.fileStore.get(fid);
        }

        if (prop === 'sendMessage') {
          return {
            message_id: mockState.nextMessageId++,
            chat: { id: params.chat_id },
            text: params.text,
          };
        }

        return true;
      };
    },
  },
);

export async function fetch(url, init = {}) {
  if (typeof mockState.fetchHandler === 'function') {
    return await mockState.fetchHandler(url, init);
  }
  throw new Error(`Unmocked outbound fetch call in test: ${url}`);
}

export { db };

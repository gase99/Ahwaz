import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
const level = process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info');

export const logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

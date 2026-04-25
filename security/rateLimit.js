import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 5, // максимум 5 спроб логіну/реєстрації
  skipSuccessfulRequests: true, // не блокувати успішні
});

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 хвилина
  max: 30, // 30 запитів за хвилину
});

export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

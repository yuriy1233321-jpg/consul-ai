import { body, validationResult } from 'express-validator';

// Валідатори для /chat
export const validateChatInput = [
  body('userId').optional().isString().trim().escape(),
  body('message').optional().isString().trim().escape().isLength({ min: 0, max: 2000 }),
  body('mode').optional().isIn(['learning', 'exam']),
];

// Валідатори для реєстрації / логіну
export const validateRegister = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').optional().isString().trim().escape().isLength({ min: 2, max: 50 }),
];

export const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty(),
];

// Middleware для перевірки результату валідації
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET is required in .env');
  process.exit(1);
}

// Просте сховище користувачів (замініть на реальну БД у продакшені)
const USERS_FILE = 'users.json';

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function registerUser(email, password, name) {
  const users = readUsers();
  if (users.find(u => u.email === email)) {
    throw new Error('User already exists');
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser = {
    id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    email,
    password: hashedPassword,
    name,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeUsers(users);
  return { id: newUser.id, email: newUser.email, name: newUser.name };
}

export function loginUser(email, password) {
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) throw new Error('Invalid credentials');
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) throw new Error('Invalid credentials');
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

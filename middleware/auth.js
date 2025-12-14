const jwt = require('jsonwebtoken');
const { User } = require('../config/database');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Токен доступа отсутствует' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jmsmp_secret_key');
    const user = await User.findOne({ username: decoded.username }).select('-password');
    
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется аутентификация' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    next();
  };
};

const requireApplicationApproved = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется аутентификация' });
  }

  if (req.user.applicationStatus !== 'accepted') {
    return res.status(403).json({ error: 'Анкета не одобрена' });
  }

  next();
};

module.exports = { authenticateToken, requireRole, requireApplicationApproved };

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadAvatar, uploadBanner } = require('../middleware/upload');

const router = express.Router();

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Валидация
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Никнейм должен быть от 3 до 20 символов' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Никнейм может содержать только буквы, цифры и подчеркивания' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    // Проверка существования пользователя
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ error: 'Этот никнейм уже занят' });
      }
      if (existingUser.email === email) {
        return res.status(400).json({ error: 'Этот email уже зарегистрирован' });
      }
    }

    // Хеширование пароля
    const hashedPassword = await bcrypt.hash(password, 12);

    // Создание пользователя
    const user = new User({
      username,
      email,
      password: hashedPassword,
      notifications: [{
        title: 'Добро пожаловать на JMSMP!',
        message: 'Ваш аккаунт успешно создан. Анкета отправлена на рассмотрение.',
        type: 'welcome'
      }]
    });

    await user.save();

    // Создание JWT токена
    const token = jwt.sign(
      { username: user.username, userId: user._id },
      process.env.JWT_SECRET || 'jmsmp_secret_key',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: 'Аккаунт успешно создан',
      token,
      user: {
        username: user.username,
        email: user.email,
        role: user.role,
        applicationStatus: user.applicationStatus,
        registrationDate: user.registrationDate
      }
    });

    // Отправляем уведомление через Socket.io
    const io = req.app.get('io');
    io.to(`user-${user._id}`).emit('notification', {
      title: 'Регистрация успешна!',
      message: 'Добро пожаловать на JMSMP!',
      type: 'success'
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Поиск пользователя
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Неверный никнейм или пароль' });
    }

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Неверный никнейм или пароль' });
    }

    // Обновление времени последнего входа
    user.lastSeen = new Date();
    await user.save();

    // Создание JWT токена
    const token = jwt.sign(
      { username: user.username, userId: user._id },
      process.env.JWT_SECRET || 'jmsmp_secret_key',
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Вход выполнен успешно',
      token,
      user: {
        username: user.username,
        email: user.email,
        role: user.role,
        applicationStatus: user.applicationStatus,
        avatar: user.avatar,
        banner: user.banner,
        lastSeen: user.lastSeen,
        registrationDate: user.registrationDate
      }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// Получение профиля
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ user });
  } catch (error) {
    console.error('Ошибка получения профиля:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновление профиля
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);

    if (email && email !== user.email) {
      // Проверка email
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({ error: 'Этот email уже используется' });
      }
      user.email = email;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Требуется текущий пароль' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ error: 'Неверный текущий пароль' });
      }

      user.password = await bcrypt.hash(newPassword, 12);
    }

    await user.save();

    res.json({ message: 'Профиль обновлен', user: {
      username: user.username,
      email: user.email,
      role: user.role
    }});

  } catch (error) {
    console.error('Ошибка обновления профиля:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка аватарки
router.post('/avatar', authenticateToken, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const user = await User.findById(req.user._id);
    user.avatar = `/uploads/avatars/${req.user.username}/${req.file.filename}`;
    await user.save();

    res.json({ 
      message: 'Аватарка обновлена',
      avatar: user.avatar 
    });

  } catch (error) {
    console.error('Ошибка загрузки аватарки:', error);
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

// Загрузка баннера
router.post('/banner', authenticateToken, uploadBanner.single('banner'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const user = await User.findById(req.user._id);
    user.banner = `/uploads/banners/${req.user.username}/${req.file.filename}`;
    await user.save();

    res.json({ 
      message: 'Баннер обновлен',
      banner: user.banner 
    });

  } catch (error) {
    console.error('Ошибка загрузки баннера:', error);
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

module.exports = router;

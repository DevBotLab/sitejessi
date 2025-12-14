const express = require('express');
const { User, Application, Photo } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Получение статистики системы
router.get('/stats', authenticateToken, requireRole(['Владелец сайта', 'Владелец', 'Администратор']), async (req, res) => {
  try {
    const [
      totalUsers,
      pendingApplications,
      acceptedApplications,
      totalPhotos,
      recentRegistrations
    ] = await Promise.all([
      User.countDocuments(),
      Application.countDocuments({ status: 'pending' }),
      Application.countDocuments({ status: 'accepted' }),
      Photo.countDocuments(),
      User.countDocuments({ 
        registrationDate: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
      })
    ]);

    // Статистика по ролям
    const roleStats = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Активность за последнюю неделю
    const weeklyActivity = await User.aggregate([
      { 
        $match: { 
          lastSeen: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$lastSeen" } },
          activeUsers: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalUsers,
      pendingApplications,
      acceptedApplications,
      totalPhotos,
      recentRegistrations,
      roleStats,
      weeklyActivity,
      serverVersion: '1.21.8'
    });

  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение списка пользователей
router.get('/users', authenticateToken, requireRole(['Владелец сайта', 'Владелец', 'Администратор', 'Куратор']), async (req, res) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    
    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ registrationDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(filter);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Изменение роли пользователя (только для главных админов)
router.put('/users/:username/role', authenticateToken, requireRole(['Владелец сайта', 'Владелец']), async (req, res) => {
  try {
    const { username } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'Роль обязательна' });
    }

    // Нельзя изменить роль главному администратору
    if (username === process.env.MAIN_ADMIN_USERNAME && req.user.username !== process.env.MAIN_ADMIN_USERNAME) {
      return res.status(403).json({ error: 'Нельзя изменить роль главному администратору' });
    }

    const user = await User.findOneAndUpdate(
      { username },
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Отправляем уведомление пользователю
    const io = req.app.get('io');
    io.to(`user-${user._id}`).emit('role-updated', {
      newRole: role,
      message: `Ваша роль изменена на: ${role}`
    });

    res.json({ 
      message: `Роль пользователя ${username} изменена на ${role}`,
      user 
    });

  } catch (error) {
    console.error('Ошибка изменения роли:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Управление набором в студию
router.put('/studio-recruitment', authenticateToken, requireRole(['Владелец сайта', 'Владелец']), async (req, res) => {
  try {
    const { enabled, message } = req.body;

    // Здесь можно сохранить настройки в базе или в файле
    // Пока просто возвращаем статус
    res.json({ 
      message: `Набор в студию ${enabled ? 'открыт' : 'закрыт'}`,
      enabled,
      announcement: message || 'Информация о наборе обновлена'
    });

    // Отправляем уведомление всем пользователям
    const io = req.app.get('io');
    io.emit('studio-recruitment-update', {
      enabled,
      message: message || `Набор в студию ${enabled ? 'открыт' : 'закрыт'}`
    });

  } catch (error) {
    console.error('Ошибка управления набором:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Системные уведомления
router.post('/notifications/broadcast', authenticateToken, requireRole(['Владелец сайта', 'Владелец', 'Администратор']), async (req, res) => {
  try {
    const { title, message, type = 'info' } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Заголовок и сообщение обязательны' });
    }

    // Добавляем уведомление всем пользователям
    await User.updateMany({}, {
      $push: {
        notifications: {
          title,
          message,
          type,
          date: new Date(),
          read: false
        }
      }
    });

    // Отправляем через Socket.io
    const io = req.app.get('io');
    io.emit('broadcast-notification', {
      title,
      message,
      type,
      date: new Date()
    });

    res.json({ message: 'Уведомление отправлено всем пользователям' });

  } catch (error) {
    console.error('Ошибка отправки уведомления:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистка старых данных
router.delete('/cleanup', authenticateToken, requireRole(['Владелец сайта']), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Удаляем неактивных пользователей с отклоненными заявками
    const result = await User.deleteMany({
      applicationStatus: 'rejected',
      lastSeen: { $lt: cutoffDate },
      role: 'Игрок'
    });

    // Удаляем старые отклоненные заявки
    await Application.deleteMany({
      status: 'rejected',
      createdAt: { $lt: cutoffDate }
    });

    res.json({ 
      message: `Очистка завершена`,
      deletedUsers: result.deletedCount,
      cutoffDate: cutoffDate.toLocaleDateString('ru-RU')
    });

  } catch (error) {
    console.error('Ошибка очистки данных:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;

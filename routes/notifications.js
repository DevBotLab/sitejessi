const express = require('express');
const { User } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получение уведомлений пользователя
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
    const user = await User.findById(req.user._id);
    let notifications = user.notifications || [];

    if (unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }

    // Сортируем по дате (новые сначала) и пагинируем
    notifications.sort((a, b) => new Date(b.date) - new Date(a.date));
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedNotifications = notifications.slice(startIndex, endIndex);

    res.json({
      notifications: paginatedNotifications,
      total: notifications.length,
      unreadCount: notifications.filter(n => !n.read).length,
      totalPages: Math.ceil(notifications.length / limit),
      currentPage: page
    });

  } catch (error) {
    console.error('Ошибка получения уведомлений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отметить уведомление как прочитанное
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const notification = user.notifications.id(req.params.notificationId);

    if (!notification) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    notification.read = true;
    await user.save();

    res.json({ message: 'Уведомление отмечено как прочитанное' });

  } catch (error) {
    console.error('Ошибка отметки уведомления:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отметить все уведомления как прочитанные
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { 'notifications.$[].read': true }
    });

    res.json({ message: 'Все уведомления отмечены как прочитанные' });

  } catch (error) {
    console.error('Ошибка отметки всех уведомлений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление уведомления
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.notifications = user.notifications.filter(
      n => n._id.toString() !== req.params.notificationId
    );

    await user.save();

    res.json({ message: 'Уведомление удалено' });

  } catch (error) {
    console.error('Ошибка удаления уведомления:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистка всех уведомлений
router.delete('/', authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { notifications: [] }
    });

    res.json({ message: 'Все уведомления очищены' });

  } catch (error) {
    console.error('Ошибка очистки уведомлений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;

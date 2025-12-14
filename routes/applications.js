const express = require('express');
const { Application, User } = require('../config/database');
const { authenticateToken, requireRole, requireApplicationApproved } = require('../middleware/auth');

const router = express.Router();

// Создание заявки на сервер
router.post('/server', authenticateToken, async (req, res) => {
  try {
    const { answers } = req.body;
    const username = req.user.username;

    // Проверяем, нет ли активной заявки
    const existingApplication = await Application.findOne({
      username,
      type: 'server',
      status: 'pending'
    });

    if (existingApplication) {
      return res.status(400).json({ error: 'У вас уже есть активная заявка' });
    }

    // Создаем заявку
    const application = new Application({
      username,
      type: 'server',
      answers
    });

    await application.save();

    // Обновляем статус пользователя
    await User.findOneAndUpdate(
      { username },
      { applicationStatus: 'pending' }
    );

    // Отправляем уведомление в Telegram (будет реализовано в боте)
    const io = req.app.get('io');
    io.to('admin-room').emit('new-application', {
      applicationId: application._id,
      username,
      type: 'server',
      date: new Date()
    });

    res.status(201).json({
      message: 'Заявка отправлена на рассмотрение',
      applicationId: application._id
    });

  } catch (error) {
    console.error('Ошибка создания заявки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создание заявки в студию
router.post('/studio', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const { answers } = req.body;
    const username = req.user.username;

    const existingApplication = await Application.findOne({
      username,
      type: 'studio',
      status: 'pending'
    });

    if (existingApplication) {
      return res.status(400).json({ error: 'У вас уже есть активная заявка в студию' });
    }

    const application = new Application({
      username,
      type: 'studio',
      answers
    });

    await application.save();

    const io = req.app.get('io');
    io.to('admin-room').emit('new-application', {
      applicationId: application._id,
      username,
      type: 'studio',
      date: new Date()
    });

    res.status(201).json({
      message: 'Заявка в студию отправлена',
      applicationId: application._id
    });

  } catch (error) {
    console.error('Ошибка создания заявки в студию:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение статуса заявки
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const applications = await Application.find({ username: req.user.username })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({ applications });
  } catch (error) {
    console.error('Ошибка получения заявок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Админ: получение всех заявок
router.get('/admin', authenticateToken, requireRole(['Владелец сайта', 'Владелец', 'Администратор', 'Куратор']), async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const applications = await Application.find(filter)
      .populate('username', 'username role')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Application.countDocuments(filter);

    res.json({
      applications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Ошибка получения заявок админом:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Админ: одобрение/отклонение заявки
router.put('/admin/:id', authenticateToken, requireRole(['Владелец сайта', 'Владелец', 'Администратор', 'Куратор']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, role } = req.body; // role только для главного админа

    const application = await Application.findById(id).populate('username');
    if (!application) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    application.status = status;
    application.reviewedBy = req.user.username;
    application.reviewDate = new Date();

    await application.save();

    // Обновляем статус пользователя
    const userUpdate = { applicationStatus: status };
    
    // Если главный админ и указана роль
    if (role && (req.user.role === 'Владелец сайта' || req.user.role === 'Владелец')) {
      userUpdate.role = role;
    }

    await User.findOneAndUpdate(
      { username: application.username.username },
      userUpdate
    );

    // Отправляем уведомление пользователю
    const io = req.app.get('io');
    io.to(`user-${application.username._id}`).emit('application-updated', {
      applicationId: application._id,
      status,
      message: status === 'accepted' ? 'Ваша заявка одобрена!' : 'Ваша заявка отклонена.'
    });

    // Уведомление в Telegram
    // (будет реализовано в боте)

    res.json({ 
      message: `Заявка ${status === 'accepted' ? 'одобрена' : 'отклонена'}`,
      application 
    });

  } catch (error) {
    console.error('Ошибка обновления заявки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;

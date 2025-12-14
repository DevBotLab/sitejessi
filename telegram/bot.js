const TelegramBot = require('node-telegram-bot-api');
const { Application, User } = require('../config/database');
const { app } = require('../server');

class JMSMPTelegramBot {
  constructor() {
    if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token_here') {
      console.log('🤖 Telegram bot disabled - no token configured');
      return;
    }

    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
      polling: true,
      allowedUpdates: ['message', 'callback_query']
    });
    
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    this.setupHandlers();
    this.setupWebhooks();
  }

  setupWebhooks() {
    // Для будущей интеграции с webhooks
    if (process.env.WEBHOOK_URL) {
      this.bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`);
    }
  }

  setupHandlers() {
    // Команда старт
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      
      try {
        // Проверяем, является ли пользователь администратором
        const admins = await User.find({
          role: { $in: ['Владелец сайта', 'Владелец', 'Администратор', 'Куратор'] }
        });
        
        const isAdmin = admins.some(admin => 
          admin.email === msg.from.username || 
          msg.from.id.toString() === this.adminChatId
        );

        if (isAdmin) {
          this.bot.sendMessage(chatId, 
            `👑 *JMSMP Admin Bot*\n\n` +
            `Добро пожаловать в панель администратора!\n\n` +
            `*Доступные команды:*\n` +
            `/stats - Статистика системы\n` +
            `/applications - Список заявок\n` +
            `/users - Список пользователей\n\n` +
            `Бот автоматически уведомляет о новых заявках.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          this.bot.sendMessage(chatId,
            `🎮 *JMSMP Bot*\n\n` +
            `Этот бот предназначен для администраторов сервера.\n` +
            `Для игроков доступен веб-сайт с полным функционалом.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error) {
        this.bot.sendMessage(chatId, '❌ Ошибка при обработке команды');
      }
    });

    // Команда статистики
    this.bot.onText(/\/stats/, async (msg) => {
      try {
        const stats = await this.getSystemStats();
        this.bot.sendMessage(msg.chat.id, stats, { parse_mode: 'Markdown' });
      } catch (error) {
        this.bot.sendMessage(msg.chat.id, '❌ Ошибка получения статистики');
      }
    });

    // Обработка callback от кнопок
    this.bot.on('callback_query', async (callbackQuery) => {
      try {
        await this.handleCallbackQuery(callbackQuery);
      } catch (error) {
        console.error('Callback error:', error);
        this.bot.answerCallbackQuery(callbackQuery.id, { 
          text: '❌ Ошибка обработки запроса' 
        });
      }
    });

    console.log('🤖 Telegram bot started successfully');
  }

  async getSystemStats() {
    const [
      totalUsers,
      pendingApps,
      acceptedApps,
      totalPhotos,
      onlineUsers
    ] = await Promise.all([
      User.countDocuments(),
      Application.countDocuments({ status: 'pending' }),
      Application.countDocuments({ status: 'accepted' }),
      require('../config/database').Photo.countDocuments(),
      User.countDocuments({ 
        lastSeen: { $gte: new Date(Date.now() - 15 * 60 * 1000) } 
      })
    ]);

    return `
📊 *Статистика системы JMSMP*

👥 *Пользователи:* ${totalUsers}
🟢 *Онлайн:* ${onlineUsers}
📋 *Заявки на рассмотрении:* ${pendingApps}
✅ *Одобренных заявок:* ${acceptedApps}
🖼️ *Фотографий в галерее:* ${totalPhotos}
🔧 *Версия:* 1.21.8
⏰ *Обновлено:* ${new Date().toLocaleString('ru-RU')}
    `.trim();
  }

  async handleCallbackQuery(callbackQuery) {
    const { data, message, from } = callbackQuery;
    const actionData = JSON.parse(data);

    try {
      const result = await this.processApplicationAction(actionData, from, message);
      this.bot.answerCallbackQuery(callbackQuery.id, { text: result.message });
      
      // Обновляем сообщение
      if (result.updatedMessage) {
        this.bot.editMessageText(result.updatedMessage, {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] }
        });
      }
    } catch (error) {
      throw error;
    }
  }

  async processApplicationAction(data, user, message) {
    const { action, applicationId, role } = data;
    const application = await Application.findById(applicationId).populate('username');
    
    if (!application) {
      throw new Error('Application not found');
    }

    // Обновляем заявку и пользователя
    const updatedApp = await this.updateApplicationStatus(application, action, role, user);
    const updatedMessage = this.formatApplicationMessage(updatedApp, updatedApp.username);

    // Отправляем уведомление через Socket.io
    const io = app.get('io');
    io.to(`user-${updatedApp.username._id}`).emit('application-updated', {
      applicationId: updatedApp._id,
      status: updatedApp.status,
      message: `Ваша заявка ${updatedApp.status === 'accepted' ? 'одобрена' : 'отклонена'} администратором`
    });

    return {
      message: `Заявка ${updatedApp.status === 'accepted' ? 'одобрена' : 'отклонена'}`,
      updatedMessage
    };
  }

  async updateApplicationStatus(application, action, role, user) {
    let newStatus = application.status;
    let userRole = application.username.role;

    switch (action) {
      case 'approve':
        newStatus = 'accepted';
        break;
      case 'reject':
        newStatus = 'rejected';
        break;
      case 'approve_with_role':
        newStatus = 'accepted';
        userRole = role;
        break;
      default:
        throw new Error('Unknown action');
    }

    application.status = newStatus;
    application.reviewedBy = user.username || `Telegram:${user.id}`;
    application.reviewDate = new Date();
    await application.save();

    // Обновляем пользователя
    await User.findByIdAndUpdate(application.username._id, {
      applicationStatus: newStatus,
      ...(userRole && { role: userRole })
    });

    return application;
  }

  formatApplicationMessage(application, user) {
    const typeEmoji = application.type === 'server' ? '🎮' : '🎨';
    const statusEmoji = application.status === 'accepted' ? '✅' : 
                        application.status === 'rejected' ? '❌' : '⏳';
    
    return `
${typeEmoji} *Заявка ${application.type === 'server' ? 'на сервер' : 'в студию'}*

👤 *Пользователь:* ${user.username}
🏷️ *Роль:* ${user.role}
📅 *Дата подачи:* ${application.createdAt.toLocaleString('ru-RU')}
👑 *Рассмотрена:* ${application.reviewedBy || 'Не рассмотрена'}
📊 *Статус:* ${statusEmoji} ${application.status}

${application.reviewDate ? `⏰ *Дата решения:* ${application.reviewDate.toLocaleString('ru-RU')}` : ''}
    `.trim();
  }

  // Метод для отправки уведомлений из других частей системы
  async sendApplicationNotification(application) {
    try {
      const user = await User.findOne({ username: application.username });
      const message = await this.bot.sendMessage(
        this.adminChatId,
        this.formatApplicationMessage(application, user),
        {
          parse_mode: 'Markdown',
          reply_markup: this.getApplicationKeyboard(application._id)
        }
      );

      await Application.findByIdAndUpdate(application._id, {
        telegramMessageId: message.message_id
      });

    } catch (error) {
      console.error('Error sending Telegram notification:', error);
    }
  }

  getApplicationKeyboard(applicationId) {
    return {
      inline_keyboard: [
        [
          { text: '✅ Одобрить', callback_data: JSON.stringify({ action: 'approve', applicationId }) },
          { text: '❌ Отклонить', callback_data: JSON.stringify({ action: 'reject', applicationId }) }
        ],
        [
          { text: '👑 Администратор', callback_data: JSON.stringify({ action: 'approve_with_role', applicationId, role: 'Администратор' }) },
          { text: '💼 Куратор', callback_data: JSON.stringify({ action: 'approve_with_role', applicationId, role: 'Куратор' }) }
        ]
      ]
    };
  }
}

// Экспортируем синглтон
module.exports = new JMSMPTelegramBot();

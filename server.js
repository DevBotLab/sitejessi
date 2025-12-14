const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Socket.io configuration для production
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || [
      "http://localhost:3000",
      "https://jmsmp-frontend.onrender.com"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware безопасности
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // разные лимиты для dev/prod
  message: {
    error: 'Слишком много запросов. Попробуйте позже.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || [
    "http://localhost:3000",
    "https://jmsmp-frontend.onrender.com",
    "https://yourdomain.com"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Preflight requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ 
  limit: process.env.MAX_FILE_SIZE || '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_FILE_SIZE || '50mb' 
}));

// Создаем папки для загрузок если их нет
const uploadDirs = [
  'public/uploads/avatars',
  'public/uploads/banners', 
  'public/uploads/gallery'
];

uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Статические файлы
app.use('/uploads', express.static('public/uploads', {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  setHeaders: (res, path) => {
    if (path.endsWith('.jpg') || path.endsWith('.png') || path.endsWith('.gif')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    version: '1.21.8',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Подключение к MongoDB с улучшенной обработкой ошибок
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    });

    console.log('✅ MongoDB successfully connected:', conn.connection.host);
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    if (process.env.NODE_ENV === 'production') {
      // В production ждем и пытаемся снова
      setTimeout(connectDB, 5000);
    } else {
      process.exit(1);
    }
    return false;
  }
};

// Инициализация главного администратора
const initializeMainAdmin = async () => {
  try {
    const { User } = require('./config/database');
    const bcrypt = require('bcryptjs');
    
    const adminExists = await User.findOne({ 
      username: process.env.MAIN_ADMIN_USERNAME 
    });
    
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(process.env.MAIN_ADMIN_PASSWORD, 12);
      
      const adminUser = new User({
        username: process.env.MAIN_ADMIN_USERNAME,
        email: process.env.MAIN_ADMIN_EMAIL,
        password: hashedPassword,
        role: 'Владелец сайта',
        applicationStatus: 'accepted',
        notifications: [{
          title: '👑 Аккаунт администратора создан',
          message: 'Вы главный администратор системы JMSMP. Добро пожаловать!',
          type: 'success'
        }]
      });
      
      await adminUser.save();
      console.log('👑 Main admin account created:', process.env.MAIN_ADMIN_USERNAME);
    } else {
      console.log('👑 Main admin account already exists');
    }
  } catch (error) {
    console.error('❌ Error initializing main admin:', error.message);
  }
};

// Загрузка маршрутов
const loadRoutes = async () => {
  try {
    // API Routes
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/applications', require('./routes/applications'));
    app.use('/api/gallery', require('./routes/gallery'));
    app.use('/api/admin', require('./routes/admin'));
    app.use('/api/notifications', require('./routes/notifications'));
    
    // Server info endpoint
    app.get('/api/server/info', async (req, res) => {
      try {
        // Этот endpoint требует аутентификации, но для теста сделаем публичным
        res.json({
          ip: process.env.SERVER_IP || 'jmsmp.minecraft.ru',
          port: process.env.SERVER_PORT || '25565',
          version: '1.21.8',
          launcher: 'https://easylauncher.org',
          status: 'online'
        });
      } catch (error) {
        res.status(500).json({ error: 'Server error' });
      }
    });

    console.log('✅ All routes loaded successfully');
  } catch (error) {
    console.error('❌ Error loading routes:', error);
    throw error;
  }
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  // Heartbeat для отслеживания активных соединений
  socket.on('heartbeat', (data) => {
    socket.emit('heartbeat-response', { timestamp: Date.now() });
  });

  // Присоединение к пользовательской комнате
  socket.on('join-user', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`👤 User ${userId} joined their room`);
  });

  // Присоединение к админской комнате
  socket.on('join-admin', (adminId) => {
    socket.join('admin-room');
    console.log(`👑 Admin ${adminId} joined admin room`);
  });

  // Отслеживание активности
  socket.on('user-activity', (data) => {
    // Можно логировать активность пользователя
    socket.to('admin-room').emit('user-activity-update', data);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
  });

  // Обработка ошибок
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Глобальный объект для Socket.io
app.set('io', io);

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'JMSMP Backend API',
    version: '1.21.8',
    description: 'Backend system for Jessie Minecraft SMP',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile'
      },
      applications: {
        server: 'POST /api/applications/server',
        studio: 'POST /api/applications/studio',
        status: 'GET /api/applications/status'
      },
      gallery: {
        my: 'GET /api/gallery/my',
        public: 'GET /api/gallery/public',
        upload: 'POST /api/gallery/upload'
      },
      admin: {
        stats: 'GET /api/admin/stats',
        users: 'GET /api/admin/users'
      }
    },
    documentation: 'https://github.com/your-repo/docs'
  });
});

// Serve frontend if exists (для монолитного деплоя)
app.use(express.static(path.join(__dirname, 'client')));
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'client', 'index.html'))) {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
  } else {
    // Если фронтенд не собран, показываем API info
    res.json({
      message: 'JMSMP Backend Server is running',
      version: '1.21.8',
      timestamp: new Date().toISOString(),
      endpoints: '/api'
    });
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('🚨 Global error handler:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({
      error: 'Validation Error',
      details: errors
    });
  }

  // Mongoose duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return res.status(400).json({
      error: 'Duplicate Entry',
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid Token',
      message: 'Please provide a valid authentication token'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token Expired',
      message: 'Your session has expired. Please login again.'
    });
  }

  // Multer file upload errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File Too Large',
      message: 'The uploaded file exceeds the size limit'
    });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected File',
      message: 'Unexpected file field in upload'
    });
  }

  // Default error
  const statusCode = error.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500 
    ? 'Internal Server Error' 
    : error.message;

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route Not Found',
    message: `The route ${req.originalUrl} does not exist`,
    availableEndpoints: '/api'
  });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Close HTTP server
    server.close(() => {
      console.log('✅ HTTP server closed');
    });

    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');
    }

    // Close Socket.io
    io.close(() => {
      console.log('✅ Socket.io closed');
    });

    console.log('👋 Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Process signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

// Initialize and start server
const startServer = async () => {
  try {
    console.log('🚀 Starting JMSMP Backend Server...');
    console.log(`📅 ${new Date().toLocaleString('ru-RU')}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 Version: 1.21.8`);

    // Connect to database
    const dbConnected = await connectDB();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize main admin
    await initializeMainAdmin();

    // Load routes
    await loadRoutes();

    // Start Telegram bot if token is provided
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token_here') {
      try {
        console.log('🤖 Starting Telegram bot...');
        require('./telegram/bot');
        console.log('✅ Telegram bot started successfully');
      } catch (botError) {
        console.error('❌ Telegram bot failed to start:', botError.message);
      }
    } else {
      console.log('🤖 Telegram bot disabled - no token provided');
    }

    // Start server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🎉 Server successfully started on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 API endpoints: http://localhost:${PORT}/api`);
      console.log(`⚡ Socket.io enabled for real-time communication`);
      
      if (process.env.NODE_ENV === 'production') {
        console.log('🏭 Production mode enabled');
      }
    });

  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = { app, server, io };

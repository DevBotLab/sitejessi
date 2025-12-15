const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/ // Только буквы, цифры и подчеркивания
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: [
      'Игрок', 
      'Владелец сайта', 
      'Владелец', 
      'Администратор',
      'Кодер', 
      'Дата-Пакер', 
      'Ресурспакер', 
      'Дизайнер', 
      'Маркетолог', 
      'Куратор', 
      'Основатель'
    ],
    default: 'Игрок'
  },
  
  notifications: [notificationSchema],
  photosCount: {
    type: Number,
    default: 0
    }
  },

  applicationStatus: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  avatar: {
    type: String,
    default: null
  },
  banner: {
    type: String,
    default: null
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  notifications: [{
    title: String,
    message: String,
    type: {
      type: String,
      enum: ['welcome', 'success', 'warning', 'error', 'info'],
      default: 'info'
    },
    date: {
      type: Date,
      default: Date.now
    },
    read: {
      type: Boolean,
      default: false
    }
  }]
}, {
  timestamps: true
});

const applicationSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    ref: 'User'
  },
  type: {
    type: String,
    enum: ['server', 'studio'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  answers: {
    type: Map,
    of: String
  },
  reviewedBy: {
    type: String,
    ref: 'User',
    default: null
  },
  reviewDate: {
    type: Date,
    default: null
  },
  telegramMessageId: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

const photoSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    ref: 'User'
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  album: {
    type: String,
    default: 'default'
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  likes: [{
    type: String,
    ref: 'User'
  }],
  views: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});
// Добавляем в существующий файл после photoSchema

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['welcome', 'success', 'warning', 'error', 'info'],
    default: 'info'
  },
  date: {
    type: Date,
    default: Date.now
  },
  read: {
    type: Boolean,
    default: false
  },
});

const User = mongoose.model('User', userSchema);
const Application = mongoose.model('Application', applicationSchema);
const Photo = mongoose.model('Photo', photoSchema);

module.exports = { User, Application, Photo };

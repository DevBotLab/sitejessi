const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Создаем папку для загрузок, если её нет
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Настройка хранения для аватаров
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(uploadDir, 'avatars', req.user.username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `avatar_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Настройка хранения для баннеров
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(uploadDir, 'banners', req.user.username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `banner_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Настройка хранения для фотографий галереи
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const albumDir = path.join(uploadDir, 'gallery', req.user.username, req.body.album || 'default');
    if (!fs.existsSync(albumDir)) {
      fs.mkdirSync(albumDir, { recursive: true });
    }
    cb(null, albumDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `photo_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Фильтр файлов
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Разрешены только изображения (JPEG, PNG, GIF, WebP)'));
  }
};

// Создаем загрузчики
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter
});

const uploadBanner = multer({
  storage: bannerStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter
});

module.exports = { uploadAvatar, uploadBanner, uploadPhoto };

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Photo, User } = require('../config/database');
const { authenticateToken, requireApplicationApproved } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();

// Получение галереи пользователя
router.get('/my', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const { album, page = 1, limit = 20 } = req.query;
    
    const filter = { username: req.user.username };
    if (album && album !== 'all') {
      filter.album = album;
    }

    const photos = await Photo.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Photo.countDocuments(filter);
    
    // Получаем статистику по альбомам
    const albumStats = await Photo.aggregate([
      { $match: { username: req.user.username } },
      { $group: {
        _id: '$album',
        count: { $sum: 1 },
        totalLikes: { $sum: { $size: '$likes' } },
        totalViews: { $sum: '$views' }
      }}
    ]);

    res.json({
      photos,
      albumStats,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Ошибка получения галереи:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение публичной галереи сервера
router.get('/public', async (req, res) => {
  try {
    const { page = 1, limit = 30, sort = 'newest' } = req.query;
    
    let sortOptions = {};
    switch (sort) {
      case 'popular':
        sortOptions = { likes: -1, views: -1 };
        break;
      case 'oldest':
        sortOptions = { createdAt: 1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }

    const photos = await Photo.find({ isPublic: true })
      .populate('username', 'username role')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Photo.countDocuments({ isPublic: true });

    res.json({
      photos,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Ошибка получения публичной галереи:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка фото в галерею
router.post('/upload', authenticateToken, requireApplicationApproved, uploadPhoto.array('photos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Файлы не загружены' });
    }

    const { album = 'default', description = '' } = req.body;
    const uploadedPhotos = [];

    for (const file of req.files) {
      const photo = new Photo({
        username: req.user.username,
        filename: file.filename,
        originalName: file.originalname,
        path: `/uploads/gallery/${req.user.username}/${album}/${file.filename}`,
        album,
        description
      });

      await photo.save();
      uploadedPhotos.push(photo);
    }

    // Обновляем статистику пользователя
    await User.findOneAndUpdate(
      { username: req.user.username },
      { $inc: { 'photosCount': uploadedPhotos.length } }
    );

    res.json({
      message: `Успешно загружено ${uploadedPhotos.length} фото`,
      photos: uploadedPhotos
    });

  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    
    // Удаляем загруженные файлы в случае ошибки
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error('Ошибка удаления файла:', unlinkError);
        }
      });
    }
    
    res.status(500).json({ error: 'Ошибка загрузки файлов' });
  }
});

// Создание альбома
router.post('/album', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const { albumName } = req.body;

    if (!albumName || albumName.length < 2) {
      return res.status(400).json({ error: 'Название альбома должно быть не менее 2 символов' });
    }

    // Проверяем, существует ли альбом
    const existingAlbum = await Photo.findOne({ 
      username: req.user.username, 
      album: albumName 
    });

    if (existingAlbum) {
      return res.status(400).json({ error: 'Альбом с таким названием уже существует' });
    }

    // Создаем папку для альбома
    const albumDir = path.join('public', 'uploads', 'gallery', req.user.username, albumName);
    if (!fs.existsSync(albumDir)) {
      fs.mkdirSync(albumDir, { recursive: true });
    }

    res.json({ message: 'Альбом создан', album: albumName });

  } catch (error) {
    console.error('Ошибка создания альбома:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Лайк фото
router.post('/:photoId/like', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.photoId);
    
    if (!photo) {
      return res.status(404).json({ error: 'Фото не найдено' });
    }

    const hasLiked = photo.likes.includes(req.user.username);
    
    if (hasLiked) {
      // Убираем лайк
      photo.likes = photo.likes.filter(username => username !== req.user.username);
    } else {
      // Добавляем лайк
      photo.likes.push(req.user.username);
    }

    await photo.save();

    res.json({ 
      liked: !hasLiked,
      likesCount: photo.likes.length 
    });

  } catch (error) {
    console.error('Ошибка лайка фото:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Просмотр фото
router.get('/:photoId/view', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const photo = await Photo.findByIdAndUpdate(
      req.params.photoId,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('username', 'username role');

    if (!photo) {
      return res.status(404).json({ error: 'Фото не найдено' });
    }

    res.json({ photo });

  } catch (error) {
    console.error('Ошибка просмотра фото:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление фото
router.delete('/:photoId', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const photo = await Photo.findOne({ 
      _id: req.params.photoId, 
      username: req.user.username 
    });

    if (!photo) {
      return res.status(404).json({ error: 'Фото не найдено или нет прав для удаления' });
    }

    // Удаляем файл
    try {
      fs.unlinkSync(path.join('public', photo.path));
    } catch (unlinkError) {
      console.error('Ошибка удаления файла:', unlinkError);
    }

    await Photo.findByIdAndDelete(req.params.photoId);

    res.json({ message: 'Фото удалено' });

  } catch (error) {
    console.error('Ошибка удаления фото:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Изменение видимости фото
router.put('/:photoId/visibility', authenticateToken, requireApplicationApproved, async (req, res) => {
  try {
    const { isPublic } = req.body;
    
    const photo = await Photo.findOneAndUpdate(
      { _id: req.params.photoId, username: req.user.username },
      { isPublic },
      { new: true }
    );

    if (!photo) {
      return res.status(404).json({ error: 'Фото не найдено' });
    }

    res.json({ 
      message: `Фото теперь ${isPublic ? 'публичное' : 'приватное'}`,
      isPublic: photo.isPublic 
    });

  } catch (error) {
    console.error('Ошибка изменения видимости:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;

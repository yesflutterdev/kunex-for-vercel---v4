const mongoose = require('mongoose');
const Favorite = require('../models/favorite.model');
const Folder = require('../models/folder.model');
const Widget = require('../models/widget.model');
const {
  validateFavorite,
  validateFavoriteUpdate,
  validateGetFavorites,
  validateBulkFavoriteOperation,
  validateAnalyticsQuery,
  validateReminderSettings
} = require('../utils/favoritesValidation');

// Add widget to favorites
exports.addFavorite = async (req, res, next) => {
  try {
    const { error, value } = validateFavorite(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { type, widgetId, folderId, notes, tags, rating, isPrivate, metadata } = value;

    // Check if widget exists
    const widget = await Widget.findById(widgetId);
    if (!widget) {
      return res.status(404).json({
        success: false,
        message: 'Widget not found',
      });
    }

    // Check if already favorited
    const existingFavorite = await Favorite.findOne({ userId, widgetId });
    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        message: 'Widget is already in your favorites',
        data: { favoriteId: existingFavorite._id }
      });
    }

    // Get or create default folder if no folder specified
    let targetFolder;
    if (folderId) {
      targetFolder = await Folder.findOne({ _id: folderId, userId });
      if (!targetFolder) {
        return res.status(404).json({
          success: false,
          message: 'Folder not found',
        });
      }
    } else {
      targetFolder = await Folder.getDefaultFolder(userId);
      if (!targetFolder) {
        targetFolder = await Folder.createDefaultFolder(userId);
      }
    }

    // Create favorite
    const favorite = new Favorite({
      userId,
      type,
      widgetId,
      folderId: targetFolder._id,
      notes,
      tags,
      rating,
      isPrivate,
      metadata: {
        ...metadata,
        deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'desktop'
      }
    });

    await favorite.save();

    // Populate the response
    const populatedFavorite = await Favorite.findById(favorite._id)
      .populate({
        path: 'widgetId',
        select: 'name type settings layout status'
      })
      .populate({
        path: 'folderId',
        select: 'name color icon'
      })
      .lean();

    res.status(201).json({
      success: true,
      message: 'Widget added to favorites successfully',
      data: { favorite: populatedFavorite },
    });
  } catch (error) {
    next(error);
  }
};

// Get user's favorites grouped by type (main favorites view)
exports.getFavorites = async (req, res, next) => {
  try {
    const { error, value } = validateGetFavorites(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { folderId, tags, rating, search, isPrivate } = value;

    // Build query options
    const options = {
      folderId,
      tags: Array.isArray(tags) ? tags : (tags ? [tags] : undefined),
      rating,
      search
    };

    if (isPrivate !== undefined) {
      options.isPrivate = isPrivate;
    }

    // Get favorites grouped by type
    const favoritesByType = await Favorite.getFavoritesGroupedByType(userId, options);

    // Transform to the expected response format
    const response = {
      pages: [],
      products: [],
      promotions: [],
      events: []
    };

    favoritesByType.forEach(group => {
      const type = group._id.toLowerCase();
      if (response.hasOwnProperty(type + 's')) {
        response[type + 's'] = group.favorites;
      }
    });

    // Get total count for pagination
    const query = { userId };
    if (folderId) query.folderId = folderId;
    if (tags) query.tags = { $in: Array.isArray(tags) ? tags : [tags] };
    if (rating) query.rating = { $gte: rating };
    if (search) query.$text = { $search: search };
    if (isPrivate !== undefined) query.isPrivate = isPrivate;

    const totalCount = await Favorite.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        ...response,
        totalCount,
        appliedFilters: {
          folderId,
          tags,
          rating,
          search,
          isPrivate
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get user's favorites with filtering and search (detailed view)
exports.getFavoritesDetailed = async (req, res, next) => {
  try {
    const { error, value } = validateGetFavorites(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { folderId, tags, rating, sortBy, sortOrder, limit, page, search, isPrivate } = value;

    // Build query options
    const options = {
      folderId,
      tags: Array.isArray(tags) ? tags : (tags ? [tags] : undefined),
      rating,
      sortBy,
      sortOrder,
      limit,
      page,
      search
    };

    if (isPrivate !== undefined) {
      options.isPrivate = isPrivate;
    }

    // Get favorites
    const favorites = await Favorite.getUserFavoritesByType(userId, options);

    // Get total count for pagination
    const query = { userId };
    if (folderId) query.folderId = folderId;
    if (tags) query.tags = { $in: Array.isArray(tags) ? tags : [tags] };
    if (rating) query.rating = { $gte: rating };
    if (search) query.$text = { $search: search };
    if (isPrivate !== undefined) query.isPrivate = isPrivate;

    const totalCount = await Favorite.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      data: {
        favorites,
        pagination: {
          currentPage: page,
          totalPages,
          totalFavorites: totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit
        },
        appliedFilters: {
          folderId,
          tags,
          rating,
          search,
          isPrivate
        },
        sortedBy: `${sortBy}_${sortOrder}`
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single favorite details
exports.getFavorite = async (req, res, next) => {
  try {
    const { favoriteId } = req.params;
    const userId = req.user.id;

    const favorite = await Favorite.findOne({ _id: favoriteId, userId })
      .populate({
        path: 'widgetId',
        select: 'name type settings layout status'
      })
      .populate({
        path: 'folderId',
        select: 'name color icon'
      })
      .lean();

    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found',
      });
    }

    // Increment view count
    await Favorite.findByIdAndUpdate(favoriteId, {
      $inc: { 'analytics.viewCount': 1 },
      $set: { 'analytics.lastInteraction': new Date() }
    });

    res.status(200).json({
      success: true,
      data: { favorite },
    });
  } catch (error) {
    next(error);
  }
};

// Update favorite
exports.updateFavorite = async (req, res, next) => {
  try {
    const { favoriteId } = req.params;
    const { error, value } = validateFavoriteUpdate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { folderId, notes, tags, rating, isPrivate, metadata } = value;

    // Check if favorite exists
    const favorite = await Favorite.findOne({ _id: favoriteId, userId });
    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found',
      });
    }

    // If moving to different folder, verify folder exists
    if (folderId && folderId !== favorite.folderId.toString()) {
      const targetFolder = await Folder.findOne({ _id: folderId, userId });
      if (!targetFolder) {
        return res.status(404).json({
          success: false,
          message: 'Target folder not found',
        });
      }
    }

    // Update favorite
    const updateData = {};
    if (folderId) updateData.folderId = folderId;
    if (notes !== undefined) updateData.notes = notes;
    if (tags) updateData.tags = tags;
    if (rating) updateData.rating = rating;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate;
    if (metadata) updateData.metadata = { ...favorite.metadata, ...metadata };

    const updatedFavorite = await Favorite.findByIdAndUpdate(
      favoriteId,
      { $set: updateData },
      { new: true }
    )
    .populate({
      path: 'widgetId',
      select: 'name type settings layout status'
    })
    .populate({
      path: 'folderId',
      select: 'name color icon'
    })
    .lean();

    res.status(200).json({
      success: true,
      message: 'Favorite updated successfully',
      data: { favorite: updatedFavorite },
    });
  } catch (error) {
    next(error);
  }
};

// Remove favorite
exports.removeFavorite = async (req, res, next) => {
  try {
    const { favoriteId } = req.params;
    const userId = req.user.id;

    const favorite = await Favorite.findOne({ _id: favoriteId, userId });
    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found',
      });
    }

    await favorite.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Favorite removed successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Check if widget is favorited
exports.checkFavoriteStatus = async (req, res, next) => {
  try {
    const { widgetId } = req.params;
    const userId = req.user.id;

    const favorite = await Favorite.findOne({ userId, widgetId })
      .populate('folderId', 'name color icon')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        isFavorited: !!favorite,
        favorite: favorite || null
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get popular tags for user
exports.getPopularTags = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 20 } = req.query;

    const tags = await Favorite.getPopularTags(userId, parseInt(limit));

    res.status(200).json({
      success: true,
      data: { tags },
    });
  } catch (error) {
    next(error);
  }
};

// Bulk operations on favorites
exports.bulkOperation = async (req, res, next) => {
  try {
    const { error, value } = validateBulkFavoriteOperation(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { favoriteIds, operation, targetFolderId, tags } = value;

    // Verify all favorites belong to user
    const favorites = await Favorite.find({
      _id: { $in: favoriteIds },
      userId
    });

    if (favorites.length !== favoriteIds.length) {
      return res.status(404).json({
        success: false,
        message: 'Some favorites not found',
      });
    }

    let result;
    switch (operation) {
      case 'move':
        // Verify target folder exists
        const targetFolder = await Folder.findOne({ _id: targetFolderId, userId });
        if (!targetFolder) {
          return res.status(404).json({
            success: false,
            message: 'Target folder not found',
          });
        }

        result = await Favorite.updateMany(
          { _id: { $in: favoriteIds } },
          { $set: { folderId: targetFolderId } }
        );
        break;

      case 'delete':
        result = await Favorite.deleteMany({ _id: { $in: favoriteIds } });
        break;

      case 'tag':
        result = await Favorite.updateMany(
          { _id: { $in: favoriteIds } },
          { $addToSet: { tags: { $each: tags } } }
        );
        break;

      case 'untag':
        result = await Favorite.updateMany(
          { _id: { $in: favoriteIds } },
          { $pullAll: { tags: tags } }
        );
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid operation',
        });
    }

    res.status(200).json({
      success: true,
      message: `Bulk ${operation} completed successfully`,
      data: {
        modifiedCount: result.modifiedCount || result.deletedCount,
        operation
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get favorites analytics
exports.getAnalytics = async (req, res, next) => {
  try {
    const { error, value } = validateAnalyticsQuery(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { timeframe, folderId, groupBy, limit } = value;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (timeframe) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Build aggregation pipeline
    const matchStage = { userId: new mongoose.Types.ObjectId(userId) };
    if (timeframe !== 'all') {
      matchStage.createdAt = { $gte: startDate };
    }
    if (folderId) {
      matchStage.folderId = new mongoose.Types.ObjectId(folderId);
    }

    let groupStage;
    switch (groupBy) {
      case 'folder':
        groupStage = {
          _id: '$folderId',
          count: { $sum: 1 },
          totalViews: { $sum: '$analytics.viewCount' },
          totalShares: { $sum: '$analytics.shareCount' },
          avgRating: { $avg: '$rating' }
        };
        break;
      case 'type':
        groupStage = {
          _id: '$type',
          count: { $sum: 1 },
          totalViews: { $sum: '$analytics.viewCount' },
          totalShares: { $sum: '$analytics.shareCount' },
          avgRating: { $avg: '$rating' }
        };
        break;
      default:
        // Group by time periods
        const dateFormat = groupBy === 'day' ? '%Y-%m-%d' : 
                          groupBy === 'week' ? '%Y-%U' : '%Y-%m';
        groupStage = {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          count: { $sum: 1 },
          totalViews: { $sum: '$analytics.viewCount' },
          totalShares: { $sum: '$analytics.shareCount' }
        };
    }

    const pipeline = [
      { $match: matchStage },
      { $group: groupStage },
      { $sort: { _id: -1 } },
      { $limit: limit }
    ];

    const analytics = await Favorite.aggregate(pipeline);

    // Get summary statistics
    const summary = await Favorite.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalFavorites: { $sum: 1 },
          totalViews: { $sum: '$analytics.viewCount' },
          totalShares: { $sum: '$analytics.shareCount' },
          avgRating: { $avg: '$rating' },
          mostRecentAdd: { $max: '$createdAt' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        analytics,
        summary: summary[0] || {},
        timeframe,
        groupBy
      },
    });
  } catch (error) {
    next(error);
  }
};

// Set reminder for favorite
exports.setReminder = async (req, res, next) => {
  try {
    const { error, value } = validateReminderSettings(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { favoriteId, reminderDate, reminderNote } = value;

    const favorite = await Favorite.findOne({ _id: favoriteId, userId });
    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found',
      });
    }

    favorite.metadata.reminderDate = reminderDate;
    favorite.metadata.reminderNote = reminderNote;
    await favorite.save();

    res.status(200).json({
      success: true,
      message: 'Reminder set successfully',
      data: {
        reminderDate,
        reminderNote
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get upcoming reminders
exports.getUpcomingReminders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { days = 7 } = req.query;

    const reminders = await Favorite.getUpcomingReminders(userId, parseInt(days));

    res.status(200).json({
      success: true,
      data: { reminders },
    });
  } catch (error) {
    next(error);
  }
}; 
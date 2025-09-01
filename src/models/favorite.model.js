const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: ['Page', 'Product', 'Promotion', 'Event'],
      required: true
    },
    widgetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Widget',
      required: true
    },
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Folder',
      required: true
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    tags: [{
      type: String,
      trim: true,
      maxlength: 50
    }],
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    visitCount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastVisited: Date,
    isPrivate: {
      type: Boolean,
      default: false
    },
    metadata: {
      addedFrom: {
        type: String,
        enum: ['search', 'explore', 'profile', 'recommendation', 'share', 'other'],
        default: 'other'
      },
      deviceType: {
        type: String,
        enum: ['mobile', 'tablet', 'desktop', 'other'],
        default: 'other'
      },
      location: {
        latitude: Number,
        longitude: Number,
        address: String
      },
      reminderDate: Date,
      reminderNote: String
    },
    analytics: {
      viewCount: {
        type: Number,
        default: 0
      },
      shareCount: {
        type: Number,
        default: 0
      },
      clickCount: {
        type: Number,
        default: 0
      },
      lastInteraction: {
        type: Date,
        default: Date.now
      }
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for better query performance
favoriteSchema.index({ userId: 1 });
favoriteSchema.index({ widgetId: 1 });
favoriteSchema.index({ folderId: 1 });
favoriteSchema.index({ userId: 1, type: 1 });
favoriteSchema.index({ userId: 1, widgetId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, folderId: 1 });
favoriteSchema.index({ userId: 1, createdAt: -1 });
favoriteSchema.index({ userId: 1, rating: -1 });
favoriteSchema.index({ userId: 1, visitCount: -1 });
favoriteSchema.index({ tags: 1 });
favoriteSchema.index({ 'metadata.reminderDate': 1 });

// Text index for search functionality
favoriteSchema.index({ 
  notes: 'text', 
  tags: 'text' 
});

// Static method to get user's favorites grouped by type
favoriteSchema.statics.getUserFavoritesByType = function(userId, options = {}) {
  const {
    folderId,
    tags,
    rating,
    sortBy = 'created',
    sortOrder = 'desc',
    limit = 20,
    page = 1,
    search
  } = options;

  const query = { userId };
  
  if (folderId) {
    query.folderId = folderId;
  }
  
  if (tags && tags.length > 0) {
    query.tags = { $in: tags };
  }
  
  if (rating) {
    query.rating = { $gte: rating };
  }

  if (search) {
    query.$text = { $search: search };
  }

  const sortOptions = {};
  const sortDirection = sortOrder === 'desc' ? -1 : 1;
  
  switch (sortBy) {
    case 'name':
      // Will be handled in populate
      break;
    case 'rating':
      sortOptions.rating = sortDirection;
      break;
    case 'visits':
      sortOptions.visitCount = sortDirection;
      break;
    case 'lastVisited':
      sortOptions.lastVisited = sortDirection;
      break;
    case 'updated':
      sortOptions.updatedAt = sortDirection;
      break;
    default:
      sortOptions.createdAt = sortDirection;
  }

  const skip = (page - 1) * limit;

  return this.find(query)
    .populate({
      path: 'widgetId',
      select: 'name type settings layout status'
    })
    .populate({
      path: 'folderId',
      select: 'name color icon'
    })
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to get favorites grouped by type for the main favorites view
favoriteSchema.statics.getFavoritesGroupedByType = function(userId, options = {}) {
  const {
    folderId,
    tags,
    rating,
    search
  } = options;

  const query = { userId };
  
  if (folderId) {
    query.folderId = folderId;
  }
  
  if (tags && tags.length > 0) {
    query.tags = { $in: tags };
  }
  
  if (rating) {
    query.rating = { $gte: rating };
  }

  if (search) {
    query.$text = { $search: search };
  }

  return this.aggregate([
    { $match: query },
    {
      $lookup: {
        from: 'widgets',
        localField: 'widgetId',
        foreignField: '_id',
        as: 'widget'
      }
    },
    {
      $lookup: {
        from: 'folders',
        localField: 'folderId',
        foreignField: '_id',
        as: 'folder'
      }
    },
    {
      $unwind: '$widget'
    },
    {
      $unwind: '$folder'
    },
    {
      $group: {
        _id: '$type',
        favorites: {
          $push: {
            _id: '$_id',
            widgetId: '$widgetId',
            widget: '$widget',
            folderId: '$folderId',
            folder: '$folder',
            notes: '$notes',
            tags: '$tags',
            rating: '$rating',
            visitCount: '$visitCount',
            lastVisited: '$lastVisited',
            isPrivate: '$isPrivate',
            metadata: '$metadata',
            analytics: '$analytics',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt'
          }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
};

// Static method to get favorites count by folder
favoriteSchema.statics.getFavoriteCountsByFolder = function(userId) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$folderId',
        count: { $sum: 1 },
        lastAdded: { $max: '$createdAt' }
      }
    },
    {
      $lookup: {
        from: 'folders',
        localField: '_id',
        foreignField: '_id',
        as: 'folder'
      }
    },
    {
      $unwind: '$folder'
    },
    {
      $project: {
        folderId: '$_id',
        folderName: '$folder.name',
        folderColor: '$folder.color',
        folderIcon: '$folder.icon',
        count: 1,
        lastAdded: 1
      }
    },
    {
      $sort: { 'folder.sortOrder': 1, 'folder.createdAt': 1 }
    }
  ]);
};

// Static method to get popular tags for user
favoriteSchema.statics.getPopularTags = function(userId, limit = 20) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $unwind: '$tags' },
    {
      $group: {
        _id: '$tags',
        count: { $sum: 1 },
        lastUsed: { $max: '$createdAt' }
      }
    },
    { $sort: { count: -1, lastUsed: -1 } },
    { $limit: limit },
    {
      $project: {
        tag: '$_id',
        count: 1,
        lastUsed: 1,
        _id: 0
      }
    }
  ]);
};

// Static method to check if widget is favorited by user
favoriteSchema.statics.isFavorited = function(userId, widgetId) {
  return this.findOne({ userId, widgetId }).lean();
};

// Static method to get favorites with upcoming reminders
favoriteSchema.statics.getUpcomingReminders = function(userId, days = 7) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  
  return this.find({
    userId,
    'metadata.reminderDate': {
      $gte: new Date(),
      $lte: endDate
    }
  })
  .populate({
    path: 'widgetId',
    select: 'name type settings'
  })
  .sort({ 'metadata.reminderDate': 1 })
  .lean();
};

// Instance method to increment visit count
favoriteSchema.methods.incrementVisitCount = function() {
  this.visitCount += 1;
  this.lastVisited = new Date();
  this.analytics.lastInteraction = new Date();
  return this.save();
};

// Instance method to increment analytics
favoriteSchema.methods.incrementAnalytics = function(type) {
  if (['viewCount', 'shareCount', 'clickCount'].includes(type)) {
    this.analytics[type] += 1;
    this.analytics.lastInteraction = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

// Pre-save middleware to update folder item count
favoriteSchema.post('save', async function(doc) {
  if (this.isNew) {
    const Folder = mongoose.model('Folder');
    await Folder.findByIdAndUpdate(
      doc.folderId,
      { 
        $inc: { itemCount: 1 },
        $set: { 'metadata.lastAccessed': new Date() }
      }
    );
  }
});

// Pre-remove middleware to update folder item count
favoriteSchema.post('deleteOne', { document: true, query: false }, async function(doc) {
  const Folder = mongoose.model('Folder');
  await Folder.findByIdAndUpdate(
    doc.folderId,
    { 
      $inc: { itemCount: -1 },
      $set: { 'metadata.lastAccessed': new Date() }
    }
  );
});

const Favorite = mongoose.model('Favorite', favoriteSchema);

module.exports = Favorite; 
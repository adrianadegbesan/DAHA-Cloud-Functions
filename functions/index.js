const functions = require("firebase-functions");

const admin = require('firebase-admin');

const { initializeApp } = require('firebase-admin/app');

admin.initializeApp();

exports.sendNotificationOnMessage = functions.firestore
  .document('Messages/{channelId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.data();
    const receiverID = messageData.receiverID;
    const senderID = messageData.senderID;
    const message = messageData.message;
    const channelID = context.params.channelId;

    // Get sender's username from user document in Users collection
    const senderDoc = await admin.firestore()
      .collection('Users')
      .doc(senderID)
      .get();

    if (!senderDoc.exists) {
      console.log('Sender not found');
      return;
    }

    const senderName = senderDoc.data().username;

    const userDoc = await admin.firestore()
      .collection('Users')
      .doc(receiverID)
      .get();

    if (!userDoc.exists) {
      console.log('User not found');
      return;
    }

    const fcmToken = userDoc.data().fcmToken;

    if (!fcmToken || fcmToken === '') {
        console.log('FCM token not found');
        return;
      }

    const payload = {
      notification: {
        title: `${senderName}`,
        body: message,
        clickAction: `openMessage`,
      },
      data: {
        channelID: channelID,
        messageID: context.params.messageId,
      },
    };
   
    await admin.messaging().sendToDevice(fcmToken, payload);
    
    console.log(fcmToken)
    console.log(payload)
    console.log('Notification sent successfully');
  });


  exports.deleteUnverifiedUsers = functions.pubsub.schedule('every 24 hours')
  .onRun(async (context) => {
    const currentTime = Date.now();
    const verificationThreshold = currentTime - (24 * 60 * 60 * 1000); // 24 hours ago

    const unverifiedUsers = await admin.auth().listUsers();
    const deletePromises = [];

    for (const userRecord of unverifiedUsers.users) {
      if (userRecord.emailVerified || userRecord.metadata.creationTime >= verificationThreshold) {
        continue;
      }

      deletePromises.push(admin.auth().deleteUser(userRecord.uid));
    }

    await Promise.all(deletePromises);

    console.log(`Deleted ${deletePromises.length} unverified users.`);
  });

  exports.getMetrics = functions.https.onCall(async (data, context) => {
    const cur_id = data.cur_id;
    const university = data.university;
  
    try {
      const mypostsSnapshot = await admin.firestore()
        .collection('Universities')
        .doc(university)
        .collection('Posts')
        .where('userID', '==', cur_id)
        .get();
  
      const savedSnapshot = await admin.firestore()
        .collection('Universities')
        .doc(university)
        .collection('Posts')
        .where('savers', 'array-contains', cur_id)
        .get();
  
      const post_count = mypostsSnapshot.size;
      const saved_count = savedSnapshot.size;
  
      return { post_count, saved_count };
    } catch (error) {
      throw new functions.https.HttpsError('internal', 'Unable to retrieve metrics', error);
    }
  });

  // Update post documents when user changes username
exports.updatePostDocumentUsernames = functions.firestore.document('Users/{userId}')
.onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const newUsername = change.after.data().username;
    const oldUsername = change.before.data().username;
    const userDoc = admin.firestore().collection('Users').doc(userId);
    const university = (await userDoc.get()).data().university;
    const postsCollection = admin.firestore().collection(`Universities/${university}/Posts`);
    
    // Update username field in all posts created by the user
    const userPosts = await postsCollection.where('userID', '==', userId).get();
    const batch = admin.firestore().batch();
    userPosts.forEach(doc => {
        const postData = doc.data();
        const updatedData = {};
        if (postData.username === oldUsername) {
            updatedData.username = newUsername;
        }
        batch.update(doc.ref, updatedData);
    });
    await batch.commit();
});

// Update message documents when user changes username
exports.updateMessageDocumentUsernames = functions.firestore.document('Users/{userId}')
.onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const newUsername = change.after.data().username;
    const oldUsername = change.before.data().username;
    const messagesCollection = admin.firestore().collection('Messages');
    
    // Update sender_username field if sender is the user
    const senderMessages = await messagesCollection.where('sender', '==', userId).get();
    const senderBatch = admin.firestore().batch();
    senderMessages.forEach(doc => {
        const messageData = doc.data();
        const updatedData = {};
        if (messageData.sender_username === oldUsername) {
            updatedData.sender_username = newUsername;
        }
        senderBatch.update(doc.ref, updatedData);
    });
    await senderBatch.commit();
    
    // Update receiver_username field if receiver is the user
    const receiverMessages = await messagesCollection.where('receiver', '==', userId).get();
    const receiverBatch = admin.firestore().batch();
    receiverMessages.forEach(doc => {
        const messageData = doc.data();
        const updatedData = {};
        if (messageData.receiver_username === oldUsername) {
            updatedData.receiver_username = newUsername;
        }
        receiverBatch.update(doc.ref, updatedData);
    });
    await receiverBatch.commit();
});


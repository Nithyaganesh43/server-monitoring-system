**Watchtower 24/7 API Documentation**

base url https://servermonitoringsystembyng.onrender.com
---

### **1. Request Verification Email**

**API:** `/auth/request`
**Method:** `POST`

**Request Structure (JSON):**


{
  "email": "user@example.com",
  "deviceId": "unique-device-id"
}


**Validations:**

* `email` → must be a valid email format.
* `deviceId` → required string, max length 500 characters.

**Response (200):**


{
  "message": "Verification email sent successfully",
  "expiresIn": 600,
  "token": "temporary-verification-token"
}


**Response (400 / 500):**


{ "error": "Invalid email format" }

 
### **3. Check Device Verification**

**API:** `/auth/check`
**Method:** `GET`

**Request Query Params:**

* `email` → valid email format
* `deviceId` → required string, max length 500

**Response (200 - Verified):**


{ "verified": true }


**Response (200 - Not Verified):**


{ "verified": false }


**Response (400 / 500):**


{ "error": "Invalid email format" }


---

### **4. Logout**

**API:** `/auth/logout`
**Method:** `POST`
**Auth Required:** Yes (`authToken` cookie)

**Response (200):**


{ "message": "Logged out successfully" }


---

### **5. Add Server for Monitoring**

**API:** `/servers/add`
**Method:** `POST`
**Auth Required:** Yes

**Request Structure (JSON):**


{
  "url": "https://example.com",
  "alertEnabled": true
}


**Validations:**

* `url` must be HTTP/HTTPS, not private/localhost, length ≤ 2048.
* Cannot add duplicate URL for same user.
* Must not exceed user’s max server limit.

**Response (201):**


{
  "message": "Server added successfully",
  "server": {
    "userEmail": "user@example.com",
    "url": "https://example.com",
    "alertEnabled": true,
    "status": "online",
    "responseTime": 120,
    "lastCheck": "2025-08-09T05:12:34.123Z",
    "consecutiveFailures": 0
  }
}


---

### **6. Get All Servers**

**API:** `/servers`
**Method:** `GET`
**Auth Required:** Yes

**Response (200):**


{
  "servers": [
    {
      "_id": "server-id",
      "url": "https://example.com",
      "status": "online",
      "responseTime": 120,
      "lastCheck": "2025-08-09T05:12:34.123Z",
      "alertEnabled": true,
      "consecutiveFailures": 0,
      "createdAt": "2025-08-01T09:10:00.000Z"
    }
  ],
  "maxServers": 5,
  "currentCount": 1
}


---

### **7. Remove Server**

**API:** `/servers/:id`
**Method:** `DELETE`
**Auth Required:** Yes

**Validations:**

* `id` must be a valid MongoDB ObjectId.
* Must belong to authenticated user.

**Response (200):**


{
  "message": "Server removed successfully",
  "server": {
    "id": "server-id",
    "url": "https://example.com"
  }
}


**Response (404):**


{ "error": "Server not found" }


---

### **8. Get Server Status Summary**

**API:** `/servers/status`
**Method:** `GET`
**Auth Required:** Yes

**Response (200):**


{
  "stats": {
    "total": 3,
    "online": 2,
    "offline": 1,
    "checking": 0
  },
  "servers": [
    {
      "_id": "server-id",
      "url": "https://example.com",
      "status": "online",
      "responseTime": 120,
      "lastCheck": "2025-08-09T05:12:34.123Z",
      "consecutiveFailures": 0
    }
  ]
}

 
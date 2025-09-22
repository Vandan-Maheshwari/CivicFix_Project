from pymongo import MongoClient
from datetime import datetime
import gridfs
from bson.objectid import ObjectId

class DatabaseSetup:
    def __init__(self, connection_string):
        """
        Initialize MongoDB connection
        Replace the connection_string with your MongoDB Atlas connection string
        Format: mongodb+srv://username:password@cluster.mongodb.net/
        """
        self.client = MongoClient("mongodb+srv://civicfix_user:civicfix_25@civicfix-cluster.jweittl.mongodb.net/")
        self.db = self.client['civicfix_user']
        self.fs = gridfs.GridFS(self.db)
        
        # Collections
        self.complaints = self.db['complaints']
        self.users = self.db['users']
        self.departments = self.db['departments']
        
        # Create indexes for better performance
        self.create_indexes()
    
    def create_indexes(self):
        """Create database indexes for better query performance"""
        # Complaints collection indexes
        self.complaints.create_index([("latitude", 1), ("longitude", 1)])
        self.complaints.create_index([("category", 1)])
        self.complaints.create_index([("district", 1)])
        self.complaints.create_index([("submitted_at", -1)])
        self.complaints.create_index([("submitted", 1)])
        
        # Users collection indexes
        self.users.create_index([("email", 1)], unique=True)
        self.users.create_index([("mobile", 1)], unique=True)
    
    def create_sample_data(self):
        """Create sample data for testing"""
        # Sample departments
        departments_data = [
            {"name": "Public Works", "categories": ["pothole", "streetlight", "sewer"]},
            {"name": "Sanitation", "categories": ["garbage", "waste_management"]},
            {"name": "Parks & Recreation", "categories": ["park_maintenance", "playground"]},
            {"name": "Traffic", "categories": ["traffic_sign", "traffic_light"]},
        ]
        
        for dept in departments_data:
            self.departments.update_one(
                {"name": dept["name"]}, 
                {"$set": dept}, 
                upsert=True
            )
        
        # Sample user
        sample_user = {
            "name": "John",
            "surname": "Doe",
            "email": "john.doe@example.com",
            "mobile": "9876543210",
            "gender": "male",
            "district": "Downtown",
            "created_at": datetime.utcnow()
        }
        
        self.users.update_one(
            {"email": sample_user["email"]}, 
            {"$set": sample_user}, 
            upsert=True
        )
        
        print("Sample data created successfully!")

# MongoDB Document Schemas (for reference)

COMPLAINT_SCHEMA = {
    "id": ObjectId,  # Auto-generated MongoDB _id
    "mobile": str,   # User's mobile number
    "name": str,     # User's first name
    "surname": str,  # User's surname
    "email": str,    # User's email
    "gender": str,   # User's gender
    "district": str, # District where complaint is from
    "block_name": str, # Block/area name
    "address": str,  # Full address
    "area_type": str, # Type of area (urban/rural/etc)
    "department": str, # Assigned department
    "category": str, # Type of issue (pothole, garbage, etc)
    "description": str, # Detailed description
    "file_path": str, # Path to uploaded image/file
    "latitude": float, # GPS latitude
    "longitude": float, # GPS longitude
    "submitted": int, # 0 = not submitted, 1 = submitted
    "submitted_at": datetime, # Timestamp when submitted
    "created_at": datetime, # When record was created
    "status": str, # pending, in_progress, resolved
    "priority": str, # low, medium, high, urgent
    "resolved_at": datetime # When issue was resolved
}

USER_SCHEMA = {
    "_id": ObjectId,
    "name": str,
    "surname": str,
    "email": str,
    "mobile": str,
    "gender": str,
    "district": str,
    "password_hash": str,
    "created_at": datetime,
    "reports_count": int,
    "points": int
}

# Usage example:
if __name__ == "__main__":
    # Replace with your MongoDB Atlas connection string
    CONNECTION_STRING = "mongodb+srv://username:password@cluster.mongodb.net/"
    
    db_setup = DatabaseSetup("mongodb+srv://civicfix_user:civicfix_25@civicfix-cluster.jweittl.mongodb.net/")
    db_setup.create_sample_data()
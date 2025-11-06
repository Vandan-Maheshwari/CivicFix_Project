from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta, timezone
import os
import uuid
import math
import gridfs
from bson.objectid import ObjectId
import jwt
import base64
from PIL import Image
from io import BytesIO
import logging
from functools import wraps
import tensorflow as tf
from tensorflow import keras
from PIL import Image
import numpy as np
# unified with predictmodel.py
from predictmodel import predict_image, MODEL_PATH

# ANONYMOUS REPORTING CONFIGURATION
ANONYMOUS_USER_CONFIG = {
    "name": "CivicFix",
    "surname": "Support",
    "email": "support@civicfix.org",
    "mobile": "9999999999",  # Replace with your organization's number
    "gender": "other",
    "district": "Bhopal"
}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Enable CORS for all routes
CORS(app, origins=["*"])

# MongoDB Atlas connection with improved error handling
try:
    MONGO_URI = os.environ.get('MONGO_URI', 'mongodb+srv://civicfix_user:civicfix_25@civicfix-cluster.jweittl.mongodb.net/')
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    
    # Test connection
    client.admin.command('ping')
    logger.info("MongoDB connection successful!")
    
    db = client['civicfix_user']
    fs = gridfs.GridFS(db)
    
except Exception as e:
    logger.error(f"MongoDB connection failed: {e}")
    exit(1)

# Collections
complaints_collection = db['complaints']
users_collection = db['users']
departments_collection = db['departments']
admin_collection = db['admin']

# Create uploads directory if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate the distance between two points on Earth using Haversine formula"""
    try:
        R = 6371000  # Earth's radius in meters
        
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    except Exception as e:
        logger.error(f"Error in haversine_distance: {e}")
        return float('inf')

def is_anonymous_report(data):
    """Check if this is an anonymous report based on the submitted data"""
    return (data.get('name') == ANONYMOUS_USER_CONFIG['name'] and 
            data.get('surname') == ANONYMOUS_USER_CONFIG['surname'] and
            data.get('email') == ANONYMOUS_USER_CONFIG['email'])

def get_complaints_for_submission(min_count=3, radius_m=500):
    """Get complaints that need to be submitted based on minimum count in area"""
    try:
        all_complaints = list(complaints_collection.find({"submitted": 0}))
        to_submit = []
        processed_ids = set()
        
        for complaint in all_complaints:
            if complaint['_id'] in processed_ids:
                continue
                
            same_area_complaints = [complaint]
            
            for other in all_complaints:
                if (complaint['_id'] != other['_id'] and 
                    complaint['category'] == other['category'] and
                    other['_id'] not in processed_ids):
                    
                    if (complaint.get('latitude') and complaint.get('longitude') and 
                        other.get('latitude') and other.get('longitude')):
                        
                        distance = haversine_distance(
                            complaint['latitude'], complaint['longitude'],
                            other['latitude'], other['longitude']
                        )
                        
                        if distance <= radius_m:
                            same_area_complaints.append(other)
            
            if len(same_area_complaints) >= min_count:
                to_submit.extend(same_area_complaints)
                for comp in same_area_complaints:
                    processed_ids.add(comp['_id'])
        
        return to_submit
    except Exception as e:
        logger.error(f"Error in get_complaints_for_submission: {e}")
        return []

def verify_token(optional=False):
    """Decorator to verify JWT token"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            token = request.headers.get('Authorization')
            
            if not token and not optional:
                return jsonify({'error': 'Token missing', 'success': False}), 401
            
            if not token and optional:
                return f(None, *args, **kwargs)
            
            try:
                # Remove 'Bearer ' prefix if present
                if token.startswith('Bearer '):
                    token = token[7:]
                
                data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
                current_user_id = data['user_id']
                
                # Verify user exists
                user = users_collection.find_one({'_id': ObjectId(current_user_id)})
                if not user:
                    return jsonify({'error': 'User not found', 'success': False}), 401
                    
            except jwt.ExpiredSignatureError:
                return jsonify({'error': 'Token expired', 'success': False}), 401
            except jwt.InvalidTokenError:
                return jsonify({'error': 'Invalid token', 'success': False}), 401
            except Exception as e:
                logger.error(f"Token verification error: {e}")
                return jsonify({'error': 'Token verification failed', 'success': False}), 401
            
            return f(current_user_id, *args, **kwargs)
        return decorated_function
    return decorator

def predict_issue_category(image_path_or_bytes):
    try:
        predicted_class, confidence = predict_image(image_path_or_bytes)
        logger.info(f"Predicted {predicted_class} ({confidence:.2f}%)")
        return predicted_class
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return "other"

# FIXED REGISTRATION ENDPOINT
@app.route('/api/register', methods=['POST'])
def register():
    """User registration endpoint - FIXED"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided', 'success': False}), 400
        
        # Validate required fields - FIXED: Only essential fields required
        required_fields = ['name', 'surname', 'email', 'mobile', 'password']
        for field in required_fields:
            if not data.get(field) or not str(data.get(field)).strip():
                return jsonify({'error': f'{field} is required', 'success': False}), 400
        
        # Clean and validate email
        email = data['email'].lower().strip()
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, email):
            return jsonify({'error': 'Invalid email format', 'success': False}), 400
        
        # Clean and validate mobile
        mobile = data['mobile'].replace(' ', '').replace('-', '').strip()
        mobile_pattern = r'^[6-9]\d{9}$'
        if not re.match(mobile_pattern, mobile):
            return jsonify({'error': 'Invalid mobile number format. Must be 10 digits starting with 6-9', 'success': False}), 400
        
        # Check if user already exists
        if users_collection.find_one({'email': email}):
            return jsonify({'error': 'Email already registered', 'success': False}), 400
        
        if users_collection.find_one({'mobile': mobile}):
            return jsonify({'error': 'Mobile number already registered', 'success': False}), 400
        
        # Password strength validation
        if len(data['password']) < 6:
            return jsonify({'error': 'Password must be at least 6 characters long', 'success': False}), 400
        
        # Create new user - FIXED: Optional fields handled properly
        user_data = {
            'name': data['name'].strip().title(),
            'surname': data['surname'].strip().title(),
            'email': email,
            'mobile': mobile,
            'gender': data.get('gender', '').lower() if data.get('gender') else '',
            'district': data.get('district', '').strip().title() if data.get('district') else '',
            'password_hash': generate_password_hash(data['password']),
            'created_at': datetime.now(timezone.utc),
            'reports_count': 0,
            'points': 0,
            'is_active': True,
            'profile_completed': bool(data.get('gender') and data.get('district'))
        }
        
        result = users_collection.insert_one(user_data)
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': str(result.inserted_id),
            'email': user_data['email'],
            'exp': datetime.now(timezone.utc) + timedelta(days=30)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'success': True,
            'message': 'User registered successfully',
            'token': token,
            'user': {
                'id': str(result.inserted_id),
                'name': user_data['name'],
                'surname': user_data['surname'],
                'email': user_data['email'],
                'mobile': user_data['mobile'],
                'gender': user_data['gender'],
                'district': user_data['district'],
                'points': user_data['points'],
                'reports_count': user_data['reports_count'],
                'profile_completed': user_data['profile_completed']
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'error': 'Registration failed. Please try again.', 'success': False}), 500

# FIXED LOGIN ENDPOINT
@app.route('/api/login', methods=['POST'])
def login():
    """User login endpoint - FIXED"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided', 'success': False}), 400
        
        if not data.get('email') or not data.get('password'):
            return jsonify({'error': 'Email and password are required', 'success': False}), 400
        
        # Find user (case-insensitive email)
        email = data['email'].lower().strip()
        user = users_collection.find_one({'email': email})
        if not user:
            return jsonify({'error': 'Invalid email or password', 'success': False}), 401
        
        if not user.get('is_active', True):
            return jsonify({'error': 'Account is deactivated', 'success': False}), 401
        
        if not check_password_hash(user['password_hash'], data['password']):
            return jsonify({'error': 'Invalid email or password', 'success': False}), 401
        
        # Update last login
        users_collection.update_one(
            {'_id': user['_id']},
            {'$set': {'last_login': datetime.now(timezone.utc)}}
        )
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': str(user['_id']),
            'email': user['email'],
            'exp': datetime.now(timezone.utc) + timedelta(days=30)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': str(user['_id']),
                'name': user['name'],
                'surname': user['surname'],
                'email': user['email'],
                'mobile': user['mobile'],
                'gender': user.get('gender', ''),
                'district': user.get('district', ''),
                'points': user.get('points', 0),
                'reports_count': user.get('reports_count', 0),
                'profile_completed': user.get('profile_completed', False)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed. Please try again.', 'success': False}), 500

@app.route('/api/profile', methods=['GET'])
@verify_token()
def get_profile(current_user_id):
    """Get user profile"""
    try:
        user = users_collection.find_one({'_id': ObjectId(current_user_id)})
        if not user:
            return jsonify({'error': 'User not found', 'success': False}), 404
        
        # Get user's recent reports
        recent_reports = list(complaints_collection.find(
            {'email': user['email']},
            {'_id': 1, 'category': 1, 'description': 1, 'status': 1, 'created_at': 1, 'address': 1}
        ).sort('created_at', -1).limit(5))
        
        for report in recent_reports:
            report['_id'] = str(report['_id'])
            report['created_at'] = report['created_at'].isoformat()
        
        return jsonify({
            'success': True,
            'user': {
                'id': str(user['_id']),
                'name': user['name'],
                'surname': user['surname'],
                'email': user['email'],
                'mobile': user['mobile'],
                'gender': user.get('gender', ''),
                'district': user.get('district', ''),
                'points': user.get('points', 0),
                'reports_count': user.get('reports_count', 0),
                'created_at': user['created_at'].isoformat(),
                'last_login': user.get('last_login', user['created_at']).isoformat(),
                'recent_reports': recent_reports
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Profile fetch error: {e}")
        return jsonify({'error': 'Failed to fetch profile', 'success': False}), 500

# UPDATED SUBMIT REPORT ENDPOINT - Description optional, category from ML
@app.route('/api/submit-report', methods=['POST'])
@verify_token(optional=True)
def submit_report(current_user_id=None):
    """Submit a new complaint/report - UPDATED: Description optional, category from ML"""
    try:
        # Handle both form data and JSON
        if request.is_json:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided', 'success': False}), 400
            image_data = None
        else:
            data = request.form.to_dict()
            image_data = request.files.get('image')
        
        # Check if this is an anonymous report
        is_anonymous = is_anonymous_report(data)
        
        # Log the type of report being submitted
        if is_anonymous:
            logger.info(f"Processing anonymous report")
        else:
            logger.info(f"Processing authenticated report from user: {current_user_id}")
        
        # UPDATED: Only validate essential fields - description is optional now
        required_fields = ['name', 'surname', 'email', 'mobile']
        for field in required_fields:
            if not data.get(field) or not str(data.get(field)).strip():
                return jsonify({'error': f'{field} is required', 'success': False}), 400
        
        # For non-anonymous reports, validate email and mobile format
        if not is_anonymous:
            # Validate email format
            import re
            email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if not re.match(email_pattern, data['email']):
                return jsonify({'error': 'Invalid email format', 'success': False}), 400
            
            # Validate mobile format (10 digits starting with 6-9)
            mobile_clean = data['mobile'].replace(' ', '').replace('-', '')
            if not re.match(r'^[6-9]\d{9}$', mobile_clean):
                return jsonify({'error': 'Invalid mobile number format', 'success': False}), 400
        
        # Handle image upload and ML prediction - REQUIRED for category prediction
        file_path = None
        predicted_category = None
        
        if image_data and hasattr(image_data, 'read'):
            try:
                # Validate image
                img = Image.open(image_data)
                img.verify()
                image_data.seek(0)  # Reset file pointer after verification
                
                # Resize if too large
                max_size = (1920, 1920)
                img = Image.open(image_data)
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                
                # Save to GridFS
                img_byte_arr = BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=85)
                img_byte_arr.seek(0)
                
                filename = secure_filename(f"{uuid.uuid4()}.jpg")
                file_id = fs.put(img_byte_arr.getvalue(), filename=filename, content_type='image/jpeg')
                file_path = str(file_id)

                # Run ML prediction - THIS IS NOW THE PRIMARY SOURCE FOR CATEGORY
                img_byte_arr.seek(0)  
                predicted_category = predict_issue_category(img_byte_arr)
                
            except Exception as e:
                logger.error(f"Image processing error: {e}")
                return jsonify({'error': 'Invalid image file or image processing failed', 'success': False}), 400
                
        elif data.get('image_base64'):
            try:
                if ',' in data['image_base64']:
                    header, image_data_b64 = data['image_base64'].split(',', 1)
                else:
                    image_data_b64 = data['image_base64']
                
                image_bytes = base64.b64decode(image_data_b64)
                
                # Validate and resize image
                img = Image.open(BytesIO(image_bytes))
                max_size = (1920, 1920)
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                
                img_byte_arr = BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=85)
                img_byte_arr.seek(0)
                
                filename = f"{uuid.uuid4()}.jpg"
                file_id = fs.put(img_byte_arr.getvalue(), filename=filename, content_type='image/jpeg')
                file_path = str(file_id)

                # Run ML prediction - THIS IS NOW THE PRIMARY SOURCE FOR CATEGORY
                img_byte_arr.seek(0)  
                predicted_category = predict_issue_category(img_byte_arr)
                
            except Exception as e:
                logger.error(f"Base64 image processing error: {e}")
                return jsonify({'error': 'Invalid image data or image processing failed', 'success': False}), 400
        else:
            # UPDATED: Image is now required for category prediction
            return jsonify({'error': 'Image is required for automatic issue detection', 'success': False}), 400

        # UPDATED: Use ML prediction as primary category, fallback to manual if available
        final_category = predicted_category or data.get("category", "other")
        
        logger.info(f"Final category: {final_category} (ML predicted: {predicted_category})")

        # Determine department and priority based on category
        department_map = {
            'pothole': 'Public Works',
            'potholes': 'Public Works',  # Handle ML model output
            'streetlight': 'Public Works', 
            'electric poles': 'Public Works',  # Handle ML model output
            'sewer': 'Public Works',
            'water_supply': 'Water Department',
            'road_repair': 'Public Works',
            'garbage': 'Sanitation',
            'Garbage': 'Sanitation',  # Handle ML model output (capitalized)
            'other': 'General'
        }
        
        priority_map = {
            'pothole': 'high',
            'potholes': 'high',
            'sewer': 'high',
            'water_supply': 'urgent',
            'streetlight': 'medium',
            'electric poles': 'medium',
            'garbage': 'medium',
            'Garbage': 'medium',
            'road_repair': 'high',
            'other': 'medium'
        }
        
        # UPDATED: Create complaint document with optional description
        complaint_data = {
            'mobile': data['mobile'].strip(),
            'name': data['name'].strip().title(),
            'surname': data['surname'].strip().title(),
            'email': data['email'].lower().strip(),
            'gender': data.get('gender', '').lower(),
            'district': data.get('district', '').strip().title(),
            'block_name': data.get('block_name', '').strip(),
            'address': data.get('address', '').strip(),
            'area_type': data.get('area_type', 'urban').lower(),
            'department': department_map.get(final_category, 'General'),
            'category': final_category,
            'description': data.get('description', 'Issue detected automatically from image').strip(),  # UPDATED: Default description
            'file_path': file_path,
            'latitude': float(data['latitude']) if data.get('latitude') and str(data['latitude']).strip() not in ['', '0', 'null'] else None,
            'longitude': float(data['longitude']) if data.get('longitude') and str(data['longitude']).strip() not in ['', '0', 'null'] else None,
            'submitted': 0,
            'submitted_at': None,
            'created_at': datetime.now(timezone.utc),
            'status': 'pending',
            'priority': priority_map.get(final_category, 'medium'),
            'user_id': ObjectId(current_user_id) if current_user_id else None,
            'is_anonymous': is_anonymous,
            'ml_predicted_category': predicted_category,  # Track ML prediction
            'upvotes': 0,
            'downvotes': 0,
            'comments': []
        }
        
        result = complaints_collection.insert_one(complaint_data)
        
        # Check if this complaint should trigger submission
        complaints_to_submit = get_complaints_for_submission()
        
        # Update submitted status for qualifying complaints
        auto_submitted = False
        if complaints_to_submit:
            complaint_ids = [c['_id'] for c in complaints_to_submit]
            complaints_collection.update_many(
                {'_id': {'$in': complaint_ids}},
                {
                    '$set': {
                        'submitted': 1,  # Mark as submitted
                        'status': 'submitted',
                        'submitted_at': datetime.now(timezone.utc)
                    }
                }
            )
            auto_submitted = True

            # Trigger RPA script in background
            import subprocess, sys
            try:
                subprocess.Popen([sys.executable, "submit_rpa.py"])
                logger.info(f"RPA script triggered for {len(complaint_ids)} complaints")
            except Exception as e:
                logger.error(f"Failed to trigger RPA script: {e}")
        
        # Update user's report count and points (only for authenticated users)
        points_awarded = 0
        if current_user_id and not is_anonymous:
            points_awarded = 10 if file_path else 5  # More points for reports with images
            users_collection.update_one(
                {'_id': ObjectId(current_user_id)},
                {'$inc': {'reports_count': 1, 'points': points_awarded}}
            )
        
        # Prepare response message based on report type
        if is_anonymous:
            success_message = 'Anonymous report submitted successfully on behalf of CivicFix community'
        else:
            success_message = 'Report submitted successfully'
        
        return jsonify({
            'success': True,
            'message': success_message,
            'complaint_id': str(result.inserted_id),
            'auto_submitted': auto_submitted,
            'is_anonymous': is_anonymous,
            'points_awarded': points_awarded,
            'ml_prediction': predicted_category,
            'final_category': final_category
        }), 201
        
    except Exception as e:
        logger.error(f"Submit report error: {e}")
        return jsonify({'error': 'Report submission failed. Please try again.', 'success': False}), 500

# Keep all other endpoints the same...
@app.route('/api/reports', methods=['GET'])
def get_reports():
    """Get all reports with optional filters"""
    try:
        # Get query parameters
        category = request.args.get('category')
        district = request.args.get('district')
        status = request.args.get('status')
        priority = request.args.get('priority')
        include_anonymous = request.args.get('include_anonymous', 'true').lower() == 'true'
        limit = min(int(request.args.get('limit', 50)), 100)  # Max 100 reports
        skip = int(request.args.get('skip', 0))
        sort_by = request.args.get('sort_by', 'created_at')
        sort_order = int(request.args.get('sort_order', -1))  # -1 for desc, 1 for asc
        
        # Build query
        query = {}
        if category and category != 'all':
            query['category'] = category
        if district and district != 'all':
            query['district'] = district
        if status and status != 'all':
            query['status'] = status
        if priority and priority != 'all':
            query['priority'] = priority
        
        # Option to exclude anonymous reports from public listing
        if not include_anonymous:
            query['is_anonymous'] = {'$ne': True}
        
        # Valid sort fields
        valid_sort_fields = ['created_at', 'submitted_at', 'priority', 'upvotes', 'status']
        if sort_by not in valid_sort_fields:
            sort_by = 'created_at'
        
        # Get reports with pagination
        reports = list(complaints_collection.find(query)
                      .sort(sort_by, sort_order)
                      .skip(skip)
                      .limit(limit))
        
        total_count = complaints_collection.count_documents(query)
        
        # Convert ObjectId to string and format response
        for report in reports:
            report['_id'] = str(report['_id'])
            if report.get('user_id'):
                report['user_id'] = str(report['user_id'])
            if report.get('submitted_at'):
                report['submitted_at'] = report['submitted_at'].isoformat()
            if report.get('created_at'):
                report['created_at'] = report['created_at'].isoformat()
            if report.get('resolved_at'):
                report['resolved_at'] = report['resolved_at'].isoformat()
            
            # Hide sensitive info for anonymous reports
            if report.get('is_anonymous'):
                report['contact_info'] = 'Anonymous Report'
        
        return jsonify({
            'success': True,
            'reports': reports,
            'count': len(reports),
            'total_count': total_count,
            'has_more': skip + len(reports) < total_count
        }), 200
        
    except Exception as e:
        logger.error(f"Get reports error: {e}")
        return jsonify({'error': 'Failed to fetch reports', 'success': False}), 500

@app.route('/api/reports/<report_id>', methods=['GET'])
def get_report_details(report_id):
    """Get detailed information about a specific report"""
    try:
        if not ObjectId.is_valid(report_id):
            return jsonify({'error': 'Invalid report ID', 'success': False}), 400
        
        report = complaints_collection.find_one({'_id': ObjectId(report_id)})
        if not report:
            return jsonify({'error': 'Report not found', 'success': False}), 404
        
        # Format response
        report['_id'] = str(report['_id'])
        if report.get('user_id'):
            report['user_id'] = str(report['user_id'])
        if report.get('submitted_at'):
            report['submitted_at'] = report['submitted_at'].isoformat()
        if report.get('created_at'):
            report['created_at'] = report['created_at'].isoformat()
        if report.get('resolved_at'):
            report['resolved_at'] = report['resolved_at'].isoformat()
        
        # Hide contact details for anonymous reports
        if report.get('is_anonymous'):
            report['name'] = 'CivicFix Community'
            report['surname'] = 'Report'
            report['email'] = 'community@civicfix.org'
            report['mobile'] = '****-****-**'
        
        return jsonify({
            'success': True,
            'report': report
        }), 200
        
    except Exception as e:
        logger.error(f"Get report details error: {e}")
        return jsonify({'error': 'Failed to fetch report details', 'success': False}), 500

@app.route('/api/image/<file_id>', methods=['GET'])
def get_image(file_id):
    """Serve uploaded images"""
    try:
        if not ObjectId.is_valid(file_id):
            return jsonify({'error': 'Invalid file ID', 'success': False}), 400
        
        # Get file from GridFS
        file_data = fs.get(ObjectId(file_id))
        
        return send_file(
            BytesIO(file_data.read()),
            mimetype=file_data.content_type or 'image/jpeg',
            as_attachment=False
        )
        
    except gridfs.errors.NoFile:
        return jsonify({'error': 'File not found', 'success': False}), 404
    except Exception as e:
        logger.error(f"Image fetch error: {e}")
        return jsonify({'error': 'Failed to fetch image', 'success': False}), 500

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    """Get user leaderboard - excludes anonymous reports"""
    try:
        limit = min(int(request.args.get('limit', 10)), 50)
        
        # Get top users by points (only authenticated users with points)
        users = list(users_collection.find(
            {'is_active': True, 'points': {'$gt': 0}},
            {'name': 1, 'surname': 1, 'points': 1, 'reports_count': 1, 'district': 1}
        ).sort('points', -1).limit(limit))
        
        leaderboard = []
        for i, user in enumerate(users, 1):
            leaderboard.append({
                'rank': i,
                'name': f"{user['name']} {user['surname']}",
                'district': user.get('district', 'N/A'),
                'reports': user.get('reports_count', 0),
                'points': user.get('points', 0)
            })
        
        return jsonify({
            'success': True,
            'leaderboard': leaderboard
        }), 200
        
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        return jsonify({'error': 'Failed to fetch leaderboard', 'success': False}), 500

@app.route('/api/map-data', methods=['GET'])
def get_map_data():
    """Get data for map visualization"""
    try:
        # Get query parameters for filtering
        category = request.args.get('category')
        district = request.args.get('district')
        status = request.args.get('status')
        include_anonymous = request.args.get('include_anonymous', 'true').lower() == 'true'
        
        # Build query
        query = {
            'latitude': {'$ne': None, '$exists': True},
            'longitude': {'$ne': None, '$exists': True}
        }
        
        if category and category != 'all':
            query['category'] = category
        if district and district != 'all':
            query['district'] = district
        if status and status != 'all':
            query['status'] = status
        if not include_anonymous:
            query['is_anonymous'] = {'$ne': True}
        
        # Get reports with location data
        reports = list(complaints_collection.find(
            query,
            {
                '_id': 1, 'latitude': 1, 'longitude': 1, 'category': 1, 
                'description': 1, 'status': 1, 'created_at': 1, 'priority': 1,
                'upvotes': 1, 'downvotes': 1, 'address': 1, 'is_anonymous': 1
            }
        ).limit(1000))  # Limit for performance
        
        map_data = []
        for report in reports:
            # Sanitize description for anonymous reports
            description = report.get('description', 'No description provided')
            if report.get('is_anonymous') and len(description) > 50:
                description = description[:50] + '... (Anonymous Report)'
            elif len(description) > 100:
                description = description[:100] + '...'
            
            map_data.append({
                'id': str(report['_id']),
                'latitude': report['latitude'],
                'longitude': report['longitude'],
                'category': report['category'],
                'description': description,
                'status': report['status'],
                'priority': report.get('priority', 'medium'),
                'upvotes': report.get('upvotes', 0),
                'downvotes': report.get('downvotes', 0),
                'address': report.get('address', ''),
                'is_anonymous': report.get('is_anonymous', False),
                'created_at': report['created_at'].isoformat() if report.get('created_at') else None
            })
        
        return jsonify({
            'success': True,
            'markers': map_data,
            'count': len(map_data)
        }), 200
        
    except Exception as e:
        logger.error(f"Map data error: {e}")
        return jsonify({'error': 'Failed to fetch map data', 'success': False}), 500

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Get available report categories"""
    try:
        categories = [
            {'id': 'pothole', 'name': 'Pothole', 'department': 'Public Works', 'priority': 'high'},
            {'id': 'potholes', 'name': 'Potholes', 'department': 'Public Works', 'priority': 'high'},
            {'id': 'streetlight', 'name': 'Street Light', 'department': 'Public Works', 'priority': 'medium'},
            {'id': 'electric poles', 'name': 'Electric Poles', 'department': 'Public Works', 'priority': 'medium'},
            {'id': 'sewer', 'name': 'Sewer Issue', 'department': 'Public Works', 'priority': 'high'},
            {'id': 'garbage', 'name': 'Garbage Collection', 'department': 'Sanitation', 'priority': 'medium'},
            {'id': 'Garbage', 'name': 'Garbage', 'department': 'Sanitation', 'priority': 'medium'},
            {'id': 'water_supply', 'name': 'Water Supply', 'department': 'Water Department', 'priority': 'urgent'},
            {'id': 'road_repair', 'name': 'Road Repair', 'department': 'Public Works', 'priority': 'high'},
            {'id': 'other', 'name': 'Other', 'department': 'General', 'priority': 'medium'}
        ]
        
        return jsonify({
            'success': True,
            'categories': categories
        }), 200
        
    except Exception as e:
        logger.error(f"Categories error: {e}")
        return jsonify({'error': 'Failed to fetch categories', 'success': False}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        client.admin.command('ping')
        db_status = 'connected'
        
        # Get basic stats
        reports_count = complaints_collection.count_documents({})
        users_count = users_collection.count_documents({})
        anonymous_count = complaints_collection.count_documents({'is_anonymous': True})
        
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        db_status = 'disconnected'
        reports_count = 0
        users_count = 0
        anonymous_count = 0
    
    return jsonify({
        'success': True,
        'status': 'healthy',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'database': db_status,
        'stats': {
            'reports': reports_count,
            'users': users_count,
            'anonymous_reports': anonymous_count
        },
        'version': '2.2.0',
        'features': ['anonymous_reporting', 'ml_prediction', 'auto_submission', 'optional_description']
    }), 200

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'Endpoint not found',
        'message': 'The requested resource was not found'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'message': 'An internal server error occurred'
    }), 500

@app.errorhandler(413)
def file_too_large(error):
    return jsonify({
        'success': False,
        'error': 'File too large',
        'message': 'File size exceeds maximum limit of 16MB'
    }), 413

@app.before_request
def before_request():
    """Log all requests for monitoring"""
    if request.endpoint not in ['health_check', 'get_image']:  # Don't log health checks and image requests
        logger.info(f"{request.method} {request.path} - {request.remote_addr}")

if __name__ == '__main__':
    print("=" * 70)
    print("🚀 Starting CivicFix Flask Application v2.2.0")
    print("=" * 70)
    print(f"📊 Database: {db.name}")
    print(f"🌍 Environment: {'Development' if app.debug else 'Production'}")
    print(f"🔐 Secret Key: {'Set' if app.config['SECRET_KEY'] != 'your-secret-key-change-in-production' else 'DEFAULT (Change in production!)'}")
    print(f"📱 Anonymous Reporting: {'Enabled' if ANONYMOUS_USER_CONFIG else 'Disabled'}")
    print(f"🤖 ML Prediction: {'Enabled' if MODEL_PATH else 'Disabled'}")
    print("\n📋 Available API Endpoints:")
    print("┌──────────────────────────────────────────────────────────────────┐")
    print("│ Authentication & User Management                                 │")
    print("├──────────────────────────────────────────────────────────────────┤")
    print("│ POST   /api/register          - User registration (FIXED)       │")
    print("│ POST   /api/login             - User login (FIXED)              │")
    print("│ GET    /api/profile           - Get user profile                │")
    print("├──────────────────────────────────────────────────────────────────┤")
    print("│ Reports Management (Enhanced - Description Optional)            │")
    print("├──────────────────────────────────────────────────────────────────┤")
    print("│ POST   /api/submit-report     - Submit complaint (ML POWERED)   │")
    print("│ GET    /api/reports           - Get all reports                  │")
    print("│ GET    /api/reports/<id>      - Get report details              │")
    print("│ GET    /api/image/<id>        - Serve images                    │")
    print("├──────────────────────────────────────────────────────────────────┤")
    print("│ Data & Analytics                                                 │")
    print("├──────────────────────────────────────────────────────────────────┤")
    print("│ GET    /api/map-data          - Get map data                    │")
    print("│ GET    /api/leaderboard       - Get leaderboard                 │")
    print("│ GET    /api/categories        - Get categories                  │")
    print("│ GET    /api/health            - Health check                    │")
    print("└──────────────────────────────────────────────────────────────────┘")
    print(f"\n🌐 Server starting on: http://0.0.0.0:5000")
    print("✅ Ready to handle requests!")
    print("🎯 New Features: ML-based category detection, Optional descriptions")
    print("🔧 Fixed: Login/Signup validation, Error handling")
    print("=" * 70)
    
    app.run(debug=True, host='0.0.0.0', port=5000)
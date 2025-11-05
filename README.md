# RFP App Backend

A comprehensive backend API for managing Request for Proposals (RFP) with user authentication, proposal generation, and ML-powered RFP discovery.

## 🚀 Features

- **User Authentication & Authorization**
  - User registration and login with JWT tokens
  - Role-based access control (Company/Employee)
  - Secure password hashing with bcrypt

- **RFP Management**
  - RFP discovery and matching using ML models
  - Save/unsave RFPs for users
  - Comprehensive RFP data management

- **Proposal Generation**
  - AI-powered proposal generation
  - File upload support with GridFS
  - Complete proposal lifecycle management

- **Profile Management**
  - Company and employee profile management
  - Profile updates and retrieval

- **File Management**
  - Document upload and storage using MongoDB GridFS
  - File serving capabilities

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **File Storage**: GridFS (MongoDB)
- **Security**: bcryptjs for password hashing
- **CORS**: Cross-origin resource sharing enabled
- **Deployment**: Vercel

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB database
- npm or yarn package manager

## 🚀 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd rfp-app-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root directory with the following variables:
   ```env
   PORT=5000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Start the production server**
   ```bash
   npm start
   ```

## 📚 API Documentation

### Authentication Routes (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/login` | User login |
| POST | `/signup` | User registration with profile |

### Proposal Routes (`/api/proposals`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/createProposal` | Create a new proposal |
| POST | `/` | Get all proposals |
| GET | `/:id` | Get proposal by ID |
| GET | `/file/:id` | Serve proposal file |
| PUT | `/:id` | Update proposal |
| DELETE | `/:id` | Delete proposal |

### RFP Discovery Routes (`/api/rfp`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/getUsersData` | Get user data | No |
| POST | `/matchedRFPdata` | Get matched RFP data | No |
| GET | `/getAllRFP` | Get all RFPs | Yes |
| POST | `/saveRFP` | Save RFP for user | Yes |
| POST | `/unsaveRFP` | Unsave RFP for user | Yes |
| GET | `/getUserandRFPData` | Get user and RFP data | No |
| POST | `/generatedProposal` | Generate proposal using ML | No |

### Profile Routes (`/api/profile`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/getProfile` | Get user profile | Yes |
| PUT | `/updateCompanyProfile` | Update company profile | Yes |

## 🗄️ Database Models

### User Model
- `fullName`: String (required)
- `email`: String (required, unique)
- `password`: String (required, hashed)
- `mobile`: String (required)
- `role`: String (enum: "company", "employee")

### RFP Model
- `title`: String
- `description`: String
- `logo`: String
- `budget`: String
- `deadline`: String
- `organization`: String
- `fundingType`: String
- `organizationType`: String
- `link`: String
- `type`: String
- `email`: String (required)

### Proposal Model
- `companyName`: String
- `companyOverview`: String
- `mission`: String
- `vision`: String
- `yearEstablished`: String
- `employeeCount`: String
- `teamMembers`: String
- `teamExperience`: String
- `certifications`: String
- `technologies`: String
- `pastProjects`: String
- `clientPortfolio`: String
- `awards`: String
- `complianceStandards`: String
- `geographicalPresence`: String
- `preferredIndustries`: String
- `uploadedDocuments`: Array of file objects
- `name`: String (required)
- `email`: String (required)

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication. Protected routes require a valid JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## 🌐 CORS Configuration

The API is configured to accept requests from:
- `https://proposal-form-frontend.vercel.app`

## 📁 Project Structure

```
rfp-app-backend/
├── controllers/          # Route controllers
│   ├── authcontroller.js
│   ├── profileController.js
│   ├── proposalController.js
│   ├── proposalGenerationMLModelController.js
│   └── rfpDiscoveryMLModelController.js
├── models/              # Database models
│   ├── CompanyProfile.js
│   ├── EmployeeProfile.js
│   ├── GeneratedProposal.js
│   ├── MatchedRFP.js
│   ├── Profile.js
│   ├── Proposal.js
│   ├── RFP.js
│   ├── SavedRFP.js
│   ├── SubmittedProposals.js
│   └── User.js
├── routes/              # API routes
│   ├── Auth.js
│   ├── Profile.js
│   ├── Proposals.js
│   └── rfpDiscoveryMLModel.js
├── utils/               # Utility functions
│   ├── dbConnect.js
│   ├── error.js
│   └── verifyUser.js
├── index.js            # Main server file
├── package.json
├── vercel.json         # Vercel deployment config
└── README.md
```

## 🚀 Deployment

The application is configured for deployment on Vercel. The `vercel.json` file contains the necessary configuration for serverless deployment.

### Environment Variables for Production
Make sure to set the following environment variables in your Vercel dashboard:
- `MONGODB_URI`
- `JWT_SECRET`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 📞 Support

For support and questions, please contact the development team or create an issue in the repository.

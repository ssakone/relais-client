# Relais Deploy Test Project

This is a test HTML project designed to test the new **Relais Deploy** feature.

## Features

- 📄 Simple HTML structure with semantic markup
- 🎨 Modern CSS with gradient background and glassmorphism effects
- ⚡ Interactive JavaScript functionality
- 📱 Responsive design
- 🚀 Ready for deployment with Relais

## Files

- `index.html` - Main HTML file
- `style.css` - CSS styling with modern design
- `script.js` - JavaScript for interactivity
- `README.md` - This documentation file

## How to Test Deploy

To test the deploy feature, run:

```bash
relais deploy test-html-project
```

Or with options:

```bash
relais deploy test-html-project --type "web" --verbose
```

**Note:** You need to have a token saved using `relais set-token <your-token>` before deploying.

## Expected Result

After successful deployment:
- The project should be zipped (< 10MB)
- Uploaded to PocketBase at https://relais.dev
- Stored in the `deploy_rc` collection
- Display "In process..." status message

## Project Structure

```
test-html-project/
├── index.html      # Main HTML file
├── style.css       # Stylesheet
├── script.js       # JavaScript functionality
└── README.md       # Documentation
```

This project demonstrates a complete web application ready for deployment through the Relais platform. 
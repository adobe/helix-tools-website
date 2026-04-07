/**
 * Example templates for the JSON2HTML Simulator.
 * Each example includes JSON data, a Mustache template, and optional rendering options.
 */

// eslint-disable-next-line import/prefer-default-export
export const examples = {
  basic: {
    json: {
      name: 'John Doe',
      email: 'john@example.com',
      message: 'Hello, World!',
    },
    template: `<div>
  <h1>Hello, {{name}}!</h1>
  <p>Email: {{email}}</p>
  <blockquote>{{message}}</blockquote>
</div>`,
  },
  array: {
    json: {
      metadata: {
        title: 'Shopping List',
        lastUpdated: '2025-01-06',
      },
      data: {
        items: [
          { name: 'Apples', quantity: 5 },
          { name: 'Bread', quantity: 2 },
          { name: 'Milk', quantity: 1 },
        ],
      },
    },
    template: `<div>
  <h1>Shopping List</h1>
  <ul>
    {{#.}}
    <li>{{name}} (x{{quantity}})</li>
    {{/.}}
  </ul>
</div>`,
    options: {
      arrayKey: 'data.items',
    },
  },
  conditional: {
    json: {
      user: 'Alice',
      isPremium: true,
      notifications: 3,
      hasNotifications: true,
    },
    template: `<div>
  <h1>Welcome, {{user}}!</h1>
  {{#isPremium}}
  <p>⭐ Premium Member</p>
  {{/isPremium}}
  {{^isPremium}}
  <p><a href="#">Upgrade to Premium</a></p>
  {{/isPremium}}
  {{#hasNotifications}}
  <p>You have {{notifications}} new notifications.</p>
  {{/hasNotifications}}
</div>`,
  },
  nested: {
    json: {
      pages: [
        {
          path: '/about',
          title: 'About Us',
          description: 'Learn about our company',
          author: 'Marketing Team',
        },
        {
          path: '/products',
          title: 'Our Products',
          description: 'Browse our product catalog',
          author: 'Product Team',
        },
        {
          path: '/contact',
          title: 'Contact Us',
          description: 'Get in touch',
          author: 'Support Team',
        },
      ],
    },
    template: `<div>
  <h1>{{title}}</h1>
  <p>{{description}}</p>
  <p>Created by {{author}} | Path: {{path}}</p>
</div>`,
    options: {
      arrayKey: 'pages',
      pathKey: 'path',
      testPath: '/products',
    },
  },
  product: {
    json: {
      name: 'Wireless Headphones',
      price: 149.99,
      currency: 'USD',
      inStock: true,
      rating: 4.5,
      features: ['Noise Canceling', 'Bluetooth 5.0', '30hr Battery', 'Foldable'],
      image: '/media/products/headphones.jpg',
      thumbnail: '/media/products/headphones-thumb.jpg',
    },
    template: `<div>
  <img src="{{image}}" alt="{{name}}">
  <h1>{{name}}</h1>
  <p>{{currency}} {{price}}</p>
  {{#inStock}}
  <p>✓ In Stock</p>
  {{/inStock}}
  {{^inStock}}
  <p>Out of Stock</p>
  {{/inStock}}
  <p>Rating: {{rating}} / 5</p>
  <h2>Features</h2>
  <ul>
    {{#features}}
    <li>{{.}}</li>
    {{/features}}
  </ul>
  <img src="{{thumbnail}}" alt="{{name}} thumbnail">
</div>`,
    options: {
      relativeURLPrefix: 'https://cdn.example.com',
    },
  },
  event: {
    json: {
      schema: 'event',
      title: 'Tech Conference 2025',
      date: 'March 15, 2025',
      location: 'San Francisco, CA',
      description: 'Join us for the biggest tech event of the year!',
      speakers: [
        { name: 'Jane Smith', topic: 'AI & Machine Learning' },
        { name: 'John Doe', topic: 'Cloud Architecture' },
      ],
      registrationOpen: true,
    },
    template: `<div>
  <h1>{{title}}</h1>
  <p>📅 {{date}} | 📍 {{location}}</p>
  <p>{{description}}</p>
  <h2>Speakers</h2>
  {{#speakers}}
  <p><strong>{{name}}</strong> — {{topic}}</p>
  {{/speakers}}
  {{#registrationOpen}}
  <p><a href="#">Register Now</a></p>
  {{/registrationOpen}}
</div>`,
  },
  contentIndex: {
    json: {
      total: 47,
      offset: 0,
      limit: 10,
      data: [
        {
          path: '/blog/2025/getting-started',
          title: 'Getting Started with Edge Delivery',
          description: 'Learn how to set up your first EDS project in minutes.',
          author: 'Content Team',
          date: '2025-01-05',
          image: '/media/blog/getting-started.jpg',
        },
        {
          path: '/blog/2025/blocks-deep-dive',
          title: 'Building Custom Blocks',
          description: 'A comprehensive guide to creating reusable blocks.',
          author: 'Developer Team',
          date: '2025-01-03',
          image: '/media/blog/blocks.jpg',
        },
        {
          path: '/blog/2024/performance-tips',
          title: 'Keeping Your Score at 100',
          description: 'Best practices for maintaining perfect Lighthouse scores.',
          author: 'Performance Team',
          date: '2024-12-28',
          image: '/media/blog/performance.jpg',
        },
      ],
    },
    template: `<div>
  <p>Showing {{limit}} of {{total}} articles</p>
  {{#.}}
  <h2><a href="{{path}}">{{title}}</a></h2>
  <p>{{description}}</p>
  <p>By {{author}} | {{date}}</p>
  <img src="{{image}}" alt="{{title}}">
  {{/.}}
</div>`,
    options: {
      arrayKey: 'data',
    },
  },
  storeLocator: {
    json: {
      region: 'San Francisco Bay Area',
      stores: [
        {
          id: 'store-001',
          name: 'Downtown Flagship',
          path: '/stores/downtown',
          address: {
            street: '123 Market Street',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
          },
          phone: '(415) 555-0123',
          hours: {
            weekday: '9:00 AM - 9:00 PM',
            weekend: '10:00 AM - 6:00 PM',
          },
          services: ['In-Store Pickup', 'Returns', 'Gift Wrapping', 'Personal Shopping'],
          isOpen: true,
        },
        {
          id: 'store-002',
          name: 'Mission District',
          path: '/stores/mission',
          address: {
            street: '456 Valencia Street',
            city: 'San Francisco',
            state: 'CA',
            zip: '94110',
          },
          phone: '(415) 555-0456',
          hours: {
            weekday: '10:00 AM - 8:00 PM',
            weekend: '11:00 AM - 7:00 PM',
          },
          services: ['In-Store Pickup', 'Returns'],
          isOpen: true,
        },
        {
          id: 'store-003',
          name: 'Palo Alto',
          path: '/stores/palo-alto',
          address: {
            street: '789 University Ave',
            city: 'Palo Alto',
            state: 'CA',
            zip: '94301',
          },
          phone: '(650) 555-0789',
          hours: {
            weekday: '9:00 AM - 9:00 PM',
            weekend: '10:00 AM - 8:00 PM',
          },
          services: ['In-Store Pickup', 'Returns', 'Repairs'],
          isOpen: false,
        },
      ],
    },
    template: `<div>
  <h1>{{name}}</h1>
  {{#isOpen}}
  <p>✓ Open Now</p>
  {{/isOpen}}
  {{^isOpen}}
  <p>Currently Closed</p>
  {{/isOpen}}
  <h2>Address</h2>
  <p>{{address.street}}</p>
  <p>{{address.city}}, {{address.state}} {{address.zip}}</p>
  <p>📞 {{phone}}</p>
  <h2>Hours</h2>
  <p><strong>Mon-Fri:</strong> {{hours.weekday}}</p>
  <p><strong>Sat-Sun:</strong> {{hours.weekend}}</p>
  <h2>Available Services</h2>
  <ul>
    {{#services}}
    <li>{{.}}</li>
    {{/services}}
  </ul>
</div>`,
    options: {
      arrayKey: 'stores',
      pathKey: 'path',
      testPath: '/stores/downtown',
    },
  },
  productCatalog: {
    json: {
      metadata: {
        category: 'Electronics',
        totalProducts: 24,
        currentPage: 1,
      },
      products: [
        {
          sku: 'LAPTOP-001',
          name: 'ProBook 15 Laptop',
          path: '/products/probook-15',
          price: {
            amount: 1299.99,
            currency: 'USD',
            salePrice: 999.99,
            onSale: true,
          },
          availability: 'in-stock',
          images: ['/media/products/probook-main.jpg', '/media/products/probook-side.jpg'],
          rating: {
            score: 4.5,
            reviewCount: 127,
          },
          badges: ['Best Seller', 'Free Shipping'],
        },
        {
          sku: 'TABLET-002',
          name: 'ProTab 10 Tablet',
          path: '/products/protab-10',
          price: {
            amount: 599.99,
            currency: 'USD',
            salePrice: null,
            onSale: false,
          },
          availability: 'in-stock',
          images: ['/media/products/protab-main.jpg'],
          rating: {
            score: 4.2,
            reviewCount: 89,
          },
          badges: ['New Arrival'],
        },
        {
          sku: 'MONITOR-003',
          name: 'UltraView 27" Monitor',
          path: '/products/ultraview-27',
          price: {
            amount: 449.99,
            currency: 'USD',
            salePrice: 379.99,
            onSale: true,
          },
          availability: 'low-stock',
          images: ['/media/products/ultraview-main.jpg'],
          rating: {
            score: 4.8,
            reviewCount: 256,
          },
          badges: ['Top Rated'],
        },
      ],
    },
    template: `<div>
  {{#images}}
  <img src="{{.}}" alt="{{name}}">
  {{/images}}
  <h1>{{name}}</h1>
  <p>SKU: {{sku}}</p>
  {{#price.onSale}}
  <p><s>{{price.currency}} {{price.amount}}</s> <strong>{{price.currency}} {{price.salePrice}}</strong></p>
  {{/price.onSale}}
  {{^price.onSale}}
  <p>{{price.currency}} {{price.amount}}</p>
  {{/price.onSale}}
  <p>⭐ {{rating.score}} / 5 ({{rating.reviewCount}} reviews)</p>
  <p>{{availability}}</p>
</div>`,
    options: {
      arrayKey: 'products',
      pathKey: 'path',
      testPath: '/products/probook-15',
      relativeURLPrefix: 'https://cdn.example.com',
    },
  },
  eventCalendar: {
    json: {
      calendar: {
        month: 'January 2025',
        year: 2025,
      },
      events: [
        {
          id: 'evt-001',
          title: 'Developer Meetup',
          path: '/events/developer-meetup',
          date: 'January 15, 2025',
          time: '6:00 PM - 8:00 PM',
          location: 'Adobe Tower, Floor 12',
          type: 'In-Person',
          capacity: 50,
          registered: 42,
          spotsLeft: 8,
          isAlmostFull: true,
          description: 'Monthly gathering for web developers to share knowledge and network.',
        },
        {
          id: 'evt-002',
          title: 'AEM Best Practices Webinar',
          path: '/events/aem-webinar',
          date: 'January 22, 2025',
          time: '10:00 AM - 11:30 AM',
          location: 'Online (Zoom)',
          type: 'Virtual',
          capacity: 500,
          registered: 234,
          spotsLeft: 266,
          isAlmostFull: false,
          description: 'Learn best practices for Edge Delivery Services from Adobe experts.',
        },
        {
          id: 'evt-003',
          title: 'Hackathon Weekend',
          path: '/events/hackathon',
          date: 'January 27-28, 2025',
          time: 'All Day',
          location: 'Innovation Lab, Building C',
          type: 'In-Person',
          capacity: 100,
          registered: 100,
          spotsLeft: 0,
          isAlmostFull: true,
          description: 'Build something amazing in 48 hours with fellow developers.',
        },
      ],
    },
    template: `<div>
  <p>{{type}}</p>
  <h1>{{title}}</h1>
  <p>📅 {{date}} | 🕐 {{time}}</p>
  <p>📍 {{location}}</p>
  <p>{{description}}</p>
  <h2>Registration</h2>
  <p>{{registered}} / {{capacity}} registered</p>
  {{#spotsLeft}}
  <p>{{spotsLeft}} spots remaining</p>
  <p><a href="#">Register Now</a></p>
  {{/spotsLeft}}
  {{^spotsLeft}}
  <p>This event is sold out</p>
  <p><a href="#">Join Waitlist</a></p>
  {{/spotsLeft}}
</div>`,
    options: {
      arrayKey: 'events',
      pathKey: 'path',
      testPath: '/events/developer-meetup',
    },
  },
};

// Lithium English strings (en)
// Keep in sync with i18n.zh.js — every key here must exist there too.
(function () {
  'use strict';
  if (!window.I18N) return;
  window.I18N.register('en', {
    lang: {
      switchTo: 'Switch to 中文',
      current: 'English',
    },

    title: {
      newTab: 'New Tab',
    },

    sidebar: {
      ariaLabel: 'Layout sidebar',
      toggleAria: 'Toggle left sidebar',

      title: {
        gridColumns: 'Max columns',
        wallpaper: 'Wallpaper',
        iconCache: 'Icon cache',
        sync: 'Cloud sync',
      },

      gridColumns: {
        rangeAria: 'Adjust home grid column upper limit',
      },

      wallpaper: {
        previewAria: 'Default background preview',
        previewLabel: 'Default',
        previewCurrentAria: 'Current wallpaper preview',
        previewCurrentLabel: 'Current',
        change: 'Change',
        clear: 'Clear',
        effects: {
          blur: 'Blur',
          blurAria: 'Wallpaper blur strength',
          dim: 'Dim',
          dimAria: 'Wallpaper dim opacity',
        },
      },

      iconCache: {
        refresh: 'Refresh non-custom icons',
      },

      sync: {
        login: 'Sign in',
        upload: 'Upload',
        download: 'Pull',
        logout: 'Sign out',
        deleteAccount: 'Delete account',
        deleteAccountTitle: 'Permanently delete your account and all cloud data',
        status: {
          notSignedIn: 'Not signed in',
          signedIn: 'Synced',
          notVerified: 'Email not verified',
          syncing: 'Syncing...',
          syncedAt: 'Synced at {time}',
        },
      },
    },

    search: {
      placeholder: 'Search the web...',
      ariaLabel: 'Search query',
      engine: {
        listAria: 'Search engine list',
        add: '+ Add search engine',
        addFormAria: 'Add search engine form',
        deleteTitle: 'Delete',
        form: {
          nameLabel: 'Name',
          namePlaceholder: 'Name (required)',
          nameAria: 'Search engine name',
          urlLabel: 'Search URL',
          urlPlaceholder: 'Search URL — must contain %s (e.g. https://example.com/search?q=%s)',
          urlAria: 'Search engine URL',
          cancel: 'Cancel',
          save: 'Save',
        },
      },
    },

    grid: {
      scrollAria: 'Shortcut scroll region',
      gridAria: 'Shortcut grid',
    },

    folder: {
      closeAria: 'Close folder',
      defaultName: 'New folder',
      renameTitle: 'Rename folder',
    },

    dialog: {
      delete: {
        title: 'Confirm delete',
        text: 'Are you sure you want to permanently delete this shortcut?<br>If this is a folder, everything inside will be deleted as well.',
        cancel: 'Cancel',
        confirm: 'Delete',
      },
      loginConsent: {
        title: 'Account & cloud sync',
        intro: 'When you register or sign in, your email and password are used for authentication. Once sync is enabled, the following extension data is uploaded so it stays consistent across your devices:',
        bullet1: 'Shortcuts and folders',
        bullet2: 'Custom search engines and current selection',
        bullet3: 'Clock configuration',
        bullet4: 'Home grid column limit',
        footnote: 'No other data is collected, and nothing is shared with any third party.',
        cancel: 'Cancel',
        agree: 'Agree and continue',
      },
      deleteAccount: {
        title: 'Permanently delete account',
        line1: 'This cannot be undone. All cloud backup data will be wiped immediately and cannot be recovered.',
        line2: 'Read the warning above carefully before confirming.',
        cancel: 'Cancel',
        confirm: 'Delete',
        confirmCountdown: 'Delete ({seconds})',
      },
      edit: {
        add: 'Add',
        edit: 'Edit',
        closeAria: 'Close',
        typeAria: 'Shortcut type',
        typeLink: 'Web link',
        typeFolder: 'Folder',
        nameLabel: 'Name',
        namePlaceholder: 'e.g. Google',
        urlLabel: 'URL',
        urlPlaceholder: 'https://...',
        iconLabel: 'Custom icon',
        iconNone: 'None',
        iconUpload: 'Choose image...',
        iconUploadDone: 'Icon set',
        iconClear: 'Clear',
        save: 'Save',
      },
      iconCrop: {
        title: 'Crop icon',
        boxAria: 'Crop selection',
        reset: 'Reset',
        cancel: 'Cancel',
        confirm: 'Crop',
      },
      clockSettings: {
        title: 'Clock settings',
        closeAria: 'Close clock settings',
        save: 'Save',
        removeTitle: 'Remove',
        add: 'Add clock',
        atLimit: 'Limit reached (max {max} clocks)',
      },
      login: {
        title: 'Cloud sync',
        desc: 'Sign in to sync data between Chrome and Firefox. Sign-up requires email verification.',
        tabLogin: 'Sign in',
        tabSignup: 'Sign up',
        emailPlaceholder: 'Email address',
        passwordPlaceholder: 'Password',
        signupPasswordPlaceholder: 'Password (8-128 chars, mixed case + digit)',
        signupPasswordConfirmPlaceholder: 'Confirm password',
        submitLogin: 'Sign in',
        submitSignup: 'Sign up',
        forgotPassword: 'Forgot password?',
        skip: 'Not now',
      },
      verify: {
        desc: 'A verification email has been sent to <span id="verify-email-target" class="verify-email-target"></span>. Open your inbox (check spam too), click the link to verify, then click "I’ve verified" below.',
        check: 'I’ve verified',
        resend: 'Resend verification email',
      },
    },

    contextMenu: {
      clockSettings: 'Clock settings',
      openInNewTab: 'Open in new tab',
      edit: 'Edit',
      delete: 'Delete',
      addShortcut: 'Add shortcut',
      changeWallpaper: 'Change wallpaper',
      removeWallpaper: 'Remove wallpaper',
    },

    drag: {
      moveToHomeHint: 'Release to move icon to home',
    },

    notice: {
      signin: {
        title: 'Not signed in',
        sub: 'Data stays on this device',
      },
    },

    toast: {
      wallpaperSaveFailedQuota: 'Wallpaper save failed — storage may be full. Try a smaller image.',
      wallpaperSaveFailedGeneric: 'Wallpaper save failed. Try a smaller image and retry.',
      syncMustVerifyEmail: 'Please verify your email first',
      syncUploaded: 'Uploaded to cloud',
      syncDownloaded: 'Pulled from cloud',
      syncNoCloudData: 'No cloud data yet',
      syncFailed: 'Sync failed — check your network',
      iconCacheUnavailable: 'Icon cache unavailable',
      iconRefreshing: 'Refreshing…',
      iconRefreshedCount: 'Refreshed {count} icons',
      iconAlreadyFresh: 'Icons are up to date',
      iconRefreshFailed: 'Refresh failed',
      accountDeleted: 'Account deleted',
    },

    auth: {
      loginPending: 'Signing in...',
      signupPending: 'Signing up...',
      signupPasswordMismatch: 'Passwords do not match',
      signupPasswordTooShort: 'Password must be at least 8 characters',
      signupPasswordTooLong: 'Password must be at most 128 characters',
      signupPasswordNeedsUpper: 'Password must contain an uppercase letter',
      signupPasswordNeedsLower: 'Password must contain a lowercase letter',
      signupPasswordNeedsDigit: 'Password must contain a digit',
      signupPasswordInvalidChar: 'Password may only contain letters, digits, space and !@#$%&*+-_=?',
      verifyChecking: 'Checking...',
      verifyNotYet: 'Not verified yet — please click the link in the email',
      verifyResendPending: 'Sending...',
      verifyResendSuccess: 'Verification email resent. You can resend again in 30 seconds.',
      verifyResendError: 'Failed to send: {detail}',
      verifyCheckError: 'Check failed: {detail}',
      deleteAccountPending: 'Deleting...',
      deleteAccountError: 'Delete failed: {detail}',
      passwordResetEmptyEmail: 'Enter your email first',
      passwordResetSent: 'Check your email',
      passwordResetError: 'Reset email failed: {detail}',
    },

    error: {
      unknown: 'Unknown error',
      emailNotFound: 'Account not found — please sign up first',
      invalidLoginCredentials: 'Incorrect email or password',
      emailExists: 'Email already registered — please sign in',
      weakPassword: 'Password must be at least 6 characters',
      invalidEmail: 'Invalid email format',
      missingPassword: 'Please enter a password',
      missingEmail: 'Please enter an email',
      tooManyAttempts: 'Too many attempts — please try again later',
      userDisabled: 'This account has been disabled',
      operationNotAllowed: 'This sign-in method is not enabled',
      quotaExceeded: 'Daily quota exhausted — please try again tomorrow',
      notSignedIn: 'Please sign in first',
      generic: 'Error: {detail}',
    },

    city: {
      beijing: 'Beijing',
      tokyo: 'Tokyo',
      seoul: 'Seoul',
      singapore: 'Singapore',
      hongKong: 'Hong Kong',
      taipei: 'Taipei',
      mumbai: 'Mumbai',
      dubai: 'Dubai',
      bangkok: 'Bangkok',
      london: 'London',
      paris: 'Paris',
      berlin: 'Berlin',
      moscow: 'Moscow',
      rome: 'Rome',
      madrid: 'Madrid',
      newYork: 'New York',
      chicago: 'Chicago',
      denver: 'Denver',
      losAngeles: 'Los Angeles',
      saoPaulo: 'São Paulo',
      vancouver: 'Vancouver',
      mexicoCity: 'Mexico City',
      auckland: 'Auckland',
      sydney: 'Sydney',
      melbourne: 'Melbourne',
      honolulu: 'Honolulu',
      cairo: 'Cairo',
      johannesburg: 'Johannesburg',
    },

    continent: {
      asia: 'Asia',
      europe: 'Europe',
      americas: 'Americas',
      oceania: 'Oceania',
      africa: 'Africa',
    },

    defaults: {
      folderName: 'Design tools',
    },
  });
})();

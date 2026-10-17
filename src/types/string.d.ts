// `String.isWellFormed` shipped in ES2024; the project lib is ES2023.
// Optional: older hosts lack the method, and codecs falls back when it is absent.
interface String {
  isWellFormed?(): boolean;
}

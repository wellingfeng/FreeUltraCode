fn main() {
    tauri_build::build();
    // `generate_context!` 在编译 lib.rs 时读取 ../dist 并嵌入 exe。cargo 默认
    // 不追踪该目录，导致“只改前端/只跑 vite build、不重编 exe”时，exe 一直嵌
    // 旧包。这里显式声明依赖，确保前端产物或源码一变就重新嵌入。
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../src");
    println!("cargo:rerun-if-changed=../index.html");
    println!("cargo:rerun-if-changed=tauri.conf.json");
}
